var spawn = require('child_process').spawn;
var co = require('co');
var coEvent = require('co-event');
var debug = require('debug')('docker-worker:shutdown_manager');

function ShutdownManager(host, config) {
  this.host = host;
  this.config = config;

  this.onIdle = this.onIdle.bind(this);
  this.onWorking = this.onWorking.bind(this);
}

ShutdownManager.prototype = {
  idleTimeout: null,

  shutdown: co(function* () {
    // Add some vague assurance that we are not still claiming tasks.
    yield this.taskListener.close();

    this.config.log('shutdown');
    spawn('shutdown', ['-h', 'now']);
  }),

  /**
  Calculate when we should shutdown this worker.

  The most important bit here is we never should return 0 we should always wait
  at least some duration prior to shutting down the worker.

  @return {Number} shutdown time in seconds.
  */
  nextShutdownTime: function* () {
    // Minimum wait time before a shutdown if the billing cycle is over _before_
    // the minimum then we wait until the next cycle.
    var minimumCycleSeconds = this.config.shutdown.minimumCycleSeconds;

    var stats = yield {
      uptime: this.host.billingCycleUptime(),
      interval: this.host.billingCycleInterval()
    };

    this.config.log('uptime', stats);


    // Remainder of the cycle in seconds.
    var remainder = stats.interval - (stats.uptime % stats.interval);

    // Note: the most important part of this logic is it never returns 0 so we
    // always have some leeway to accept more work as part of a billing cycle.

    // We are so close to the end of this billing cycle we go another before
    // trigger a shutdown.
    if (remainder <= minimumCycleSeconds) {
      return remainder + (stats.interval - minimumCycleSeconds);
    }

    // We are somewhere in the billing cycle but not close to the end...
    return Math.max(remainder - minimumCycleSeconds, minimumCycleSeconds);
  },

  onIdle: co(function* () {
    var shutdownTime = yield this.nextShutdownTime();
    this.config.log('pending shutdown', {
      time: shutdownTime
    });

    this.idleTimeout =
      setTimeout(this.shutdown.bind(this), shutdownTime * 1000);
  }),

  onWorking: co(function* () {
    if (this.idleTimeout !== null) {
      this.config.log('cancel pending shutdown');
      clearTimeout(this.idleTimeout);
      this.idleTimeout = null;
    }
  }),

  observe: function (taskListener) {
    if (!this.config.shutdown.enabled) {
      this.config.log('shutdowns disabled');
      return;
    }

    this.taskListener = taskListener;
    this.taskListener.on('idle', this.onIdle);
    this.taskListener.on('working', this.onWorking);

    // Kick off the idle timer if we started in an idle state.
    if (taskListener.pending === 0) {
      this.onIdle();
    }
  }
};

module.exports = ShutdownManager;

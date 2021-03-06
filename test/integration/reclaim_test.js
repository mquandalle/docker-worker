suite('Reclaiming task', function() {
  var co = require('co');
  var waitForEvent = require('../../lib/wait_for_event');
  var settings = require('../settings');
  var cmd = require('./helper/cmd');

  var LocalWorker = require('../localworker');
  var TestWorker = require('../testworker');

  // Ensure we don't leave behind our test configurations.
  teardown(settings.cleanup);

  var worker;
  setup(co(function * () {
    settings.configure({
      task: {
        // just use crazy high reclaim divisor... This will result in way to
        // frequent reclaims but allow us to easily test that it reclaims at
        // least once...
        reclaimDivisor: 1000
      }
    });

    worker = new TestWorker(LocalWorker);
    yield worker.launch();
  }));

  teardown(co(function* () {
    yield worker.terminate();
  }));

  test('wait for reclaim', co(function* () {
    var reclaims = [];
    worker.on('issued reclaim', function(value) {
      reclaims.push(value);
    });

    var result = yield worker.postToQueue({
      payload: {
        image: 'taskcluster/test-ubuntu',
        command: cmd(
          'sleep 10'
        ),
        maxRunTime: 60 * 60
      }
    });
    assert.ok(reclaims.length > 1, 'issued more than one reclaim');

    assert.ok(
      new Date(reclaims[0].claim.takenUntil) <
      new Date(reclaims[reclaims.length - 1].claim.takenUntil),
      'Last reclaim occurs after the first reclaim'
    );

    assert.ok(result.run.success, 'task is successful');
  }));
});


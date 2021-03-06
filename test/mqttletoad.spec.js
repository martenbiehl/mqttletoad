/* eslint-env mocha */
'use strict';

const expect = require('unexpected');
const {MqttClient} = require('mqtt');
const {connect} = require('..');
const {createBroker} = require('./harness');
const getPort = require('get-port');
const os = require('os');
const path = require('path');

describe('mqttletoad', function() {
  let broker;
  let client;
  let port;

  afterEach(async function() {
    if (client) {
      try {
        await client.end();
      } catch (ignored) {}
    }
    if (broker) {
      try {
        await broker.stop();
      } catch (ignored) {}
    }
    client = null;
    broker = null;
  });

  describe('method', function() {
    describe('connect()', function() {
      describe('MITM', function() {
        this.slow(200);

        beforeEach(async function() {
          broker = await createBroker({mitm: true});
        });

        it('should connect without port nor path', async function() {
          client = await expect(connect({mitm: true}), 'to be fulfilled');
        });
      });

      describe('IPC', function() {
        this.slow(200);

        beforeEach(async function() {
          broker = await createBroker({
            path: path.join(os.tmpdir(), `mqttletoad-${Date.now()}`)
          });
        });

        it('should allow connection via a path', async function() {
          client = await expect(
            connect({path: broker.path}),
            'to be fulfilled'
          );
        });
      });

      describe('TCP', function() {
        describe('when given no arguments', function() {
          it('should reject', async function() {
            return expect(connect(), 'to be rejected with', /invalid/i);
          });
        });

        describe('when given a valid connection object', function() {
          beforeEach(async function() {
            port = await getPort();
            broker = await createBroker({port});
          });

          it('should fulfill', async function() {
            client = await expect(
              connect({
                host: 'localhost',
                port,
                protocol: 'mqtt'
              }),
              'to be fulfilled'
            );
          });
        });

        describe('upon first connection', function() {
          let promise;

          beforeEach(async function() {
            port = await getPort();
            broker = await createBroker({port});
            promise = connect(`mqtt://localhost:${port}`).then(c => {
              client = c;
              return c;
            });
          });

          it('should resolve with the wrapped MqttClient once connected', async function() {
            return expect(
              promise,
              'when fulfilled',
              expect.it('to be a', MqttClient)
            );
          });

          it('should assign `sessionPresent` property', async function() {
            return expect(
              promise,
              'when fulfilled',
              expect.it('to have property', 'sessionPresent', false)
            );
          });
        });

        describe('upon subsequent connections', function() {
          beforeEach(async function() {
            port = await getPort();
            broker = await createBroker({port});
            client = await connect(`mqtt://localhost:${port}`, {
              // reduce this so we don't have to wait 1000ms for the
              // reconnection attempt
              reconnectPeriod: 20
            });
            broker.transformers.connack = _ => ({
              returnCode: 0,
              sessionPresent: true
            });
            // kills the underlying stream, which the client
            // interprets as a remote disconnection
            client.stream.end();
            // at this point, it should automatically reconnect
          });

          it('should update `sessionPresent` accordingly', async function() {
            await expect(
              new Promise((resolve, reject) => {
                client.once('connect', () => {
                  resolve(client);
                });
              }),
              'to be fulfilled with value satisfying',
              {sessionPresent: true}
            );
          });
        });
      });
    });
  });

  describe('decoders & encoders', function() {
    it('should handle custom encoders and decoders');
  });

  describe('MQTT client behavior', function() {
    beforeEach(async function() {
      port = await getPort();
      broker = await createBroker({port});
      client = await connect(`mqtt://localhost:${port}`);
    });

    describe('publish()', function() {
      describe('encoder', function() {
        describe('when passed an unknown encoder', async function() {
          it('should reject', function() {
            return expect(
              client.publish('foo', 'bar', {encoder: 'foo'}),
              'to be rejected with',
              /unknown/i
            );
          });
        });

        describe('when passed a weird thing', function() {
          it('should reject', async function() {
            return expect(
              client.publish('foo', 'bar', {encoder: new Date()}),
              'to be rejected with',
              TypeError
            );
          });
        });

        describe('when given a function', function() {
          it('should fulfill', async function() {
            return expect(
              client.publish('foo', 'bar', {encoder: value => value}),
              'to be fulfilled'
            );
          });
        });
      });

      describe('default QoS (0)', function() {
        it('should publish with the (string) message and fulfill', async function() {
          return expect(
            client.publish('foo', 'bar'),
            'to be fulfilled with',
            void 0
          );
        });

        it('should publish with the (Buffer) message and fulfill', async function() {
          return expect(
            client.publish('foo', Buffer.from([0x00, 0x01, 0x02])),
            'to be fulfilled with',
            void 0
          );
        });
      });

      describe('QoS 1', function() {
        it('should publish with the (string) message and fulfill', async function() {
          return expect(
            client.publish('foo', 'bar'),
            'to be fulfilled with',
            void 0
          );
        });

        it('should publish with the (Buffer) message and fulfill', async function() {
          return expect(
            client.publish('foo', Buffer.from([0x00, 0x01, 0x02])),
            'to be fulfilled with',
            void 0
          );
        });
      });
    });

    describe('subscribe()', function() {
      describe('error recovery', function() {
        it('should remove event listener if subscription fails');
      });

      describe('invalid parameters', function() {
        describe('no parameters', function() {
          it('should reject', async function() {
            return expect(() => client.subscribe(), 'to be rejected');
          });
        });

        describe('undefined listener', function() {
          it('should reject', async function() {
            return expect(() => client.subscribe('foo/bar'), 'to be rejected');
          });
        });

        describe('non-function listener', function() {
          it('should reject', async function() {
            return expect(
              () => client.subscribe('foo/bar', {}),
              'to be rejected'
            );
          });
        });
      });

      it('should subscribe to a topic w/ QoS 0', async function() {
        return expect(
          client.subscribe('foo/bar', () => {}),
          'to be fulfilled with',
          {
            topic: 'foo/bar',
            qos: 0
          }
        );
      });

      it('should subscribe to a topic w/ QoS 1', async function() {
        return expect(
          client.subscribe('foo/bar', () => {}, {qos: 1}),
          'to be fulfilled with',
          {
            topic: 'foo/bar',
            qos: 1
          }
        );
      });

      it('should subscribe to a topic w/ QoS 2', async function() {
        return expect(
          client.subscribe('foo/bar', () => {}, {qos: 2}),
          'to be fulfilled with',
          {
            topic: 'foo/bar',
            qos: 2
          }
        );
      });

      it('should execute the listener when exact matching topic received', async function() {
        return new Promise((resolve, reject) => {
          client.subscribe('foo/bar', message => {
            expect(String(message), 'to equal', 'baz');
            resolve();
          });
          client.publish('foo/bar', 'baz');
        });
      });

      it('should execute the listener when wildcard (#) topic received', async function() {
        return new Promise((resolve, reject) => {
          client.subscribe('foo/#', message => {
            expect(String(message), 'to equal', 'quux');
            resolve();
          });
          client.publish('foo/bar', 'quux');
        });
      });

      it('should execute the listener when wildcard (+) topic received', async function() {
        return new Promise((resolve, reject) => {
          client.subscribe('foo/+/baz', message => {
            expect(String(message), 'to equal', 'quux');
            resolve();
          });
          client.publish('foo/bar/baz', 'quux');
        });
      });

      it('should always call the listener with a raw packet', function() {
        return new Promise((resolve, reject) => {
          client.subscribe('foo/+', (message, packet) => {
            expect(packet, 'to satisfy', {
              cmd: 'publish',
              retain: false,
              qos: 0,
              dup: false,
              length: 12,
              topic: 'foo/bar',
              payload: expect.it('when decoded as', 'utf-8', 'to equal', 'baz')
            });
            resolve();
          });
          client.publish('foo/bar', 'baz');
        });
      });

      it('should execute all matching handlers (in order of specificity)', async function() {
        const received = [];
        await Promise.all([
          client.subscribe('foo/+/bar', _ => {
            received.push('foo/+/bar');
          }),
          client.subscribe('foo/#', _ => {
            received.push('foo/#');
          }),
          client.subscribe('foo/quux/bar', _ => {
            received.push('foo/quux/bar');
          })
        ]);

        // QoS 1 means we get the puback, so we can be sure the handlers were
        // called.
        await client.publish('foo/quux/bar', 'baz', {qos: 1});
        expect(received, 'to equal', ['foo/quux/bar', 'foo/+/bar', 'foo/#']);
      });

      it('should subscribe to the same topic twice', async function() {
        const received = [];
        await client.subscribe('foo/bar', msg => {
          received.push('one');
        });
        await client.subscribe('foo/bar', msg => {
          received.push('two');
        });
        await client.publish('foo/bar', 'baz', {qos: 1});
        expect(received, 'to equal', ['one', 'two']);
      });
    });

    describe('unsubscribe()', function() {
      describe('when multiple listeners present', function() {
        const listenerA = () => {};
        const listenerB = () => {};

        beforeEach(async function() {
          return Promise.all([
            client.subscribe('foo/bar', listenerA),
            client.subscribe('foo/bar', listenerB)
          ]);
        });

        describe('when called with no listener', function() {
          it('should unsubscribe from topic', async function() {
            return expect(
              client.unsubscribe('foo/bar'),
              'to be fulfilled with',
              true
            );
          });
        });

        describe('when called with a single listener', function() {
          it('should not unsubscribe from topic', async function() {
            return expect(
              client.unsubscribe('foo/bar', listenerA),
              'to be fulfilled with',
              false
            );
          });
        });
      });
    });

    describe('end()', function() {
      describe('when connected', function() {
        it('should disconnect', async function() {
          await expect(client.end(), 'to be fulfilled');
          expect(client.connected, 'to be', false);
        });
      });

      describe('when disconnected', function() {
        it('should stay disconnected', async function() {
          await client.end();
          expect(client.reconnecting, 'to be', false);
        });
      });
    });
  });
});

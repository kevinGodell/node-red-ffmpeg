'use strict';

const jsonParse = require('./lib/jsonParse');

const { spawn, ChildProcess } = require('child_process');

module.exports = RED => {
  const {
    settings,
    _,
    nodes: { createNode, registerType },
  } = RED;

  const { ffmpegSpawn = {} } = settings;

  const { cmdPath = 'ffmpeg' } = ffmpegSpawn;

  class FfmpegSpawnNode {
    constructor(config) {
      createNode(this, config);

      try {
        this.ffmpeg = undefined;

        this.running = false;

        this.cmdPath = config.cmdPath.trim() || cmdPath;

        this.cmdArgs = config.cmdArgs ? jsonParse(config.cmdArgs) : ['-version'];

        this.cmdOutputs = parseInt(config.cmdOutputs);

        this.splitOutput = config.msgOutput !== 'combined';

        this.killSignal = ['SIGHUP', 'SIGINT', 'SIGKILL', 'SIGTERM'].includes(config.killSignal) ? config.killSignal : 'SIGTERM';

        FfmpegSpawnNode.validateCmdPath(this.cmdPath); // throws

        FfmpegSpawnNode.validateCmdArgs(this.cmdArgs); // throws

        FfmpegSpawnNode.validateCmdOutputs(this.cmdOutputs); // throws

        this.on('input', this.onInput);

        this.on('close', this.onClose);

        this.status({ fill: 'green', shape: 'ring', text: _('ffmpeg-spawn.info.ready') });
      } catch (err) {
        this.error(err);

        this.status({ fill: 'red', shape: 'dot', text: err.toString() });
      }
    }

    static validateCmdPath(cmdPath) {
      if (!/ffmpeg/i.test(cmdPath)) {
        throw new Error(_('ffmpeg-spawn.error.cmd_path_invalid', { cmdPath }));
      }
    }

    static validateCmdArgs(cmdArgs) {
      if (!Array.isArray(cmdArgs)) {
        throw new Error(_('ffmpeg-spawn.error.cmd_args_invalid', { cmdArgs }));
      }
    }

    static validateCmdOutputs(cmdOutputs) {
      if (!Number.isInteger(cmdOutputs) || cmdOutputs < 0 || cmdOutputs > 5) {
        throw new Error(_('ffmpeg-spawn.error.cmd_outputs_invalid', { cmdOutputs }));
      }
    }

    static createStdio(cmdOutputs) {
      const stdio = ['pipe'];

      switch (cmdOutputs) {
        case 0:
          stdio.push(...['ignore', 'ignore']);

          break;

        case 1:
          stdio.push(...['pipe', 'ignore']);

          break;

        default:
          for (let i = 0; i < cmdOutputs; ++i) {
            stdio.push('pipe');
          }

          break;
      }

      return stdio;
    }

    async onInput(msg) {
      const { payload, action } = msg;

      // needs to be a priority case if being used
      if (this.running && Buffer.isBuffer(payload)) {
        this.ffmpeg.stdin.write(payload);

        return;
      }

      if (typeof action === 'object') {
        const { command, signal, path, args, outputs, topics } = action;

        switch (command) {
          case 'start':
            this.start(payload, path, args, outputs, topics);

            break;

          case 'stop':
            await this.stop(signal);

            break;

          case 'restart':
            await this.stop(signal);

            this.start(payload, path, args, outputs, topics);

            break;

          default:
            this.log('unknown command', command);
        }

        return;
      }
    }

    async onClose(removed, done) {
      this.removeListener('input', this.onInput);

      this.removeListener('close', this.onClose);

      await this.stop('SIGKILL');

      const message = removed ? _('ffmpeg-spawn.info.removed') : _('ffmpeg-spawn.info.closed');

      this.status({ fill: 'grey', shape: 'ring', text: message });

      done();
    }

    start(payload, path, args, outputs, topics) {
      if (!this.running) {
        try {
          let cmdPath;

          if (typeof path !== 'undefined') {
            FfmpegSpawnNode.validateCmdPath(path); // throws

            cmdPath = path;
          } else {
            cmdPath = this.cmdPath;
          }

          let cmdArgs;

          if (typeof args !== 'undefined') {
            FfmpegSpawnNode.validateCmdArgs(args); // throws

            cmdArgs = args;
          } else {
            cmdArgs = this.cmdArgs;
          }

          let stdio;

          if (!this.splitOutput && typeof outputs !== 'undefined') {
            FfmpegSpawnNode.validateCmdOutputs(outputs); // throws

            stdio = FfmpegSpawnNode.createStdio(outputs);
          } else {
            stdio = FfmpegSpawnNode.createStdio(this.cmdOutputs);
          }

          this.ffmpeg = spawn(cmdPath, cmdArgs, { stdio });

          this.ffmpeg.on('error', err => {
            this.error(err);

            this.status({ fill: 'red', shape: 'dot', text: err.toString() });
          });

          const { pid } = this.ffmpeg;

          if (pid) {
            this.running = true;

            const message = `pid: ${pid}`;

            const topic = this.getTopic(0);

            const status = 'spawn';

            this.status({ fill: 'green', shape: 'dot', text: message });

            this.send({ topic, payload: { status, pid } });

            this.ffmpeg.once('close', (code, signal) => {
              this.ffmpeg.stdin.removeAllListeners('error');

              for (let i = 1; i < stdio.length; ++i) {
                if (stdio[i] === 'pipe') {
                  this.ffmpeg.stdio[i].removeAllListeners('data');
                }
              }

              const { pid, killed } = this.ffmpeg;

              const message = `code: ${code}, signal: ${signal}, killed: ${killed}`;

              const topic = 'status';

              const status = 'close';

              this.status({ fill: 'red', shape: 'dot', text: message });

              this.send({ topic, payload: { status, pid, code, signal, killed } });

              this.ffmpeg = undefined;

              this.running = false;
            });

            this.ffmpeg.stdin.on('error', err => {
              console.log(`${this.id}: ${err.toString()}`);
            });

            if (Buffer.isBuffer(payload)) {
              this.ffmpeg.stdin.write(payload);
            }

            for (let i = 1; i < stdio.length; ++i) {
              if (stdio[i] === 'pipe') {
                const topic = this.getTopic(i);

                if (this.splitOutput) {
                  const wires = [];

                  this.ffmpeg.stdio[i].on('data', data => {
                    wires[i] = { topic, payload: data };

                    this.send(wires);
                  });
                } else {
                  this.ffmpeg.stdio[i].on('data', data => {
                    this.send({ topic, payload: data });
                  });
                }
              }
            }
          }
        } catch (err) {
          this.error(err);

          this.status({ fill: 'red', shape: 'dot', text: err.toString() });
        }
      }
    }

    stop(signal) {
      if (this.running && this.ffmpeg instanceof ChildProcess) {
        const { pid, exitCode, signalCode } = this.ffmpeg;

        if (typeof pid === 'number' && exitCode === null && signalCode === null) {
          return new Promise((resolve, reject) => {
            this.ffmpeg.once('close', (code, signal) => {
              resolve();
            });

            const killSignal = ['SIGHUP', 'SIGINT', 'SIGKILL', 'SIGTERM'].includes(signal) ? signal : this.killSignal;

            if (this.ffmpeg.kill(0) && !this.ffmpeg.stdin.destroyed) {
              this.ffmpeg.stdin.destroy();

              this.ffmpeg.kill(killSignal);
            }
          });
        }
      }

      return Promise.resolve();
    }

    getTopic(index) {
      switch (index) {
        case 0:
          return 'status';

        case 1:
          return 'stdout';

        case 2:
          return 'stderr';

        default:
          return `stdio${index}`;
      }
    }
  }

  FfmpegSpawnNode.type = 'ffmpeg-spawn';

  FfmpegSpawnNode.settings = {
    settings: {
      ffmpegSpawn: {
        value: {
          cmdPath,
        },
        exportable: true,
      },
    },
  };

  registerType(FfmpegSpawnNode.type, FfmpegSpawnNode, FfmpegSpawnNode.settings);
};

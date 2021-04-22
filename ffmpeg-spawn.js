'use strict';

const ffmpeg = require('./lib/ffmpeg');

const jsonParse = require('./lib/jsonParse');

const { spawn, ChildProcess } = require('child_process');

module.exports = RED => {
  const {
    settings,
    _,
    nodes: { createNode, registerType },
  } = RED;

  class FfmpegSpawnNode {
    constructor(config) {
      createNode(this, config);

      try {
        this.ffmpeg = undefined;

        this.running = false;

        this.stdio = undefined;

        this.cmdPath = config.cmdPath.trim() || ffmpeg.cmdPath;

        this.cmdArgs = config.cmdArgs ? jsonParse(config.cmdArgs) : ffmpeg.cmdArgs;

        this.cmdOutputs = parseInt(config.cmdOutputs);

        this.killSignal = ['SIGHUP', 'SIGINT', 'SIGKILL', 'SIGTERM'].includes(config.killSignal) ? config.killSignal : 'SIGTERM';

        this.validateCmd();

        this.createStdio();

        this.on('input', this.onInput);

        this.on('close', this.onClose);

        this.status({ fill: 'green', shape: 'ring', text: _('ffmpeg-spawn.info.ready') });
      } catch (err) {
        this.error(err);

        this.status({ fill: 'red', shape: 'dot', text: err.toString() });
      }
    }

    validateCmd() {
      if (!/ffmpeg/i.test(this.cmdPath)) {
        throw new Error(_('ffmpeg-spawn.error.cmd_path_invalid', { cmdPath: this.cmdPath }));
      }

      if (!Array.isArray(this.cmdArgs)) {
        throw new Error(_('ffmpeg-spawn.error.cmd_args_invalid', { cmdArgs: this.cmdArgs }));
      }

      if (Number.isNaN(this.cmdOutputs) || this.cmdOutputs < 0 || this.cmdOutputs > 5) {
        throw new Error(_('ffmpeg-spawn.error.cmd_outputs_invalid', { cmdOutputs: this.cmdOutputs }));
      }
    }

    createStdio() {
      this.stdio = ['pipe'];

      switch (this.cmdOutputs) {
        case 0:
          this.stdio.push(...['ignore', 'ignore']);

          break;

        case 1:
          this.stdio.push(...['pipe', 'ignore']);

          break;

        default:
          for (let i = 0; i < this.cmdOutputs; ++i) {
            this.stdio.push('pipe');
          }

          break;
      }
    }

    async onInput(msg) {
      const { payload, action } = msg;

      // needs to be a priority case if being used
      if (this.running && Buffer.isBuffer(payload)) {
        this.ffmpeg.stdin.write(payload);

        return;
      }

      if (typeof action === 'object') {
        const { command, signal, args } = action;

        switch (command) {
          case 'start':
            this.start(payload, args);

            break;

          case 'stop':
            await this.stop(signal);

            break;

          case 'restart':
            await this.stop(signal);

            this.start(payload, args);

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

    start(payload, args) {
      if (!this.running) {
        const cmdArgs = Array.isArray(args) ? args : this.cmdArgs;

        this.ffmpeg = spawn(this.cmdPath, cmdArgs, { stdio: this.stdio });

        this.ffmpeg.on('error', err => {
          this.error(err);

          this.status({ fill: 'red', shape: 'dot', text: err.toString() });
        });

        const { pid } = this.ffmpeg;

        if (pid) {
          this.running = true;

          const message = `pid: ${pid}`;

          this.status({ fill: 'green', shape: 'dot', text: message });

          this.send({ payload: { status: 'spawn', pid } });

          this.ffmpeg.once('close', (code, signal) => {
            this.ffmpeg.stdin.removeAllListeners('error');

            for (let i = 1; i < this.stdio.length; ++i) {
              if (this.stdio[i] === 'pipe') {
                this.ffmpeg.stdio[i].removeAllListeners('data');
              }
            }

            const { pid, killed } = this.ffmpeg;

            const message = `code: ${code}, signal: ${signal}, killed: ${killed}`;

            this.status({ fill: 'red', shape: 'dot', text: message });

            this.send({ payload: { status: 'close', pid, code, signal, killed } });

            this.ffmpeg = undefined;

            this.running = false;
          });

          this.ffmpeg.stdin.on('error', err => {
            console.log(`${this.id}: ${err.toString()}`);
          });

          if (Buffer.isBuffer(payload)) {
            this.ffmpeg.stdin.write(payload);
          }

          for (let i = 1; i < this.stdio.length; ++i) {
            if (this.stdio[i] === 'pipe') {
              this.ffmpeg.stdio[i].on('data', data => {
                const wires = [];

                wires[i] = { payload: data };

                this.send(wires);
              });
            }
          }
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
  }

  FfmpegSpawnNode.type = 'ffmpeg-spawn';

  FfmpegSpawnNode.settings = {
    settings: {
      ffmpegSpawn: {
        value: {
          // timeLimit: FfmpegSpawnNode.timeLimit,
          // sizeLimit: FfmpegSpawnNode.sizeLimit,
        },
        exportable: true,
      },
    },
  };

  registerType(FfmpegSpawnNode.type, FfmpegSpawnNode, FfmpegSpawnNode.settings);
};

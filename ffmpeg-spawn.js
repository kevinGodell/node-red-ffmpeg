'use strict';

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

        this.cmdPath = config.cmdPath.trim() || FfmpegSpawnNode.cmdPath;

        this.cmdArgs = config.cmdArgs ? FfmpegSpawnNode.jsonParse(config.cmdArgs) : ['-version'];

        this.cmdOutputs = parseInt(config.cmdOutputs);

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

    async onInput(msg) {
      const { payload, action, filename } = msg;

      // needs to be a priority case if being used
      if (this.running && Buffer.isBuffer(payload)) {
        if (payload.length) {
          this.ffmpeg.stdin.write(payload);
        } else {
          await this.stop();
        }

        return;
      }

      if (typeof action === 'object') {
        const { command, signal, path, args, env } = action;

        switch (command) {
          case 'start':
            this.start(payload, path, args, env, filename);

            break;

          case 'stop':
            await this.stop(signal);

            break;

          case 'restart':
            await this.stop(signal);

            this.start(payload, path, args, env, filename);

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

    start(payload, cmdPath, cmdArgs, cmdEnv, outFilenames) {
      if (!this.running) {
        try {
          if (typeof cmdPath !== 'undefined') {
            FfmpegSpawnNode.validateCmdPath(cmdPath); // throws
          } else {
            cmdPath = this.cmdPath;
          }

          if (typeof cmdArgs !== 'undefined') {
            FfmpegSpawnNode.validateCmdArgs(cmdArgs); // throws
          } else {
            cmdArgs = this.cmdArgs;
          }

          outFilenames = typeof outFilenames === 'string' ? [outFilenames] : Array.isArray(outFilenames) ? outFilenames : [];

          const topics = this.createTopics();

          const stdio = this.createStdio();

          const env = typeof cmdEnv === 'object' ? { ...process.env, ...cmdEnv } : process.env;

          this.ffmpeg = spawn(cmdPath, cmdArgs, { stdio, env });

          this.ffmpeg.on('error', err => {
            this.error(err);

            const status = 'error';

            const error = err.toString();

            this.status({ fill: 'red', shape: 'dot', text: error });

            this.send({ topic: topics[0], payload: { status, error } });
          });

          const { pid } = this.ffmpeg;

          if (pid) {
            this.running = true;

            const message = `pid: ${pid}`;

            const status = 'spawn';

            this.status({ fill: 'green', shape: 'dot', text: message });

            this.send({ topic: topics[0], payload: { status, pid } });

            this.ffmpeg.once('close', (code, signal) => {
              this.ffmpeg.stdin.removeAllListeners('error');

              for (let i = 1; i < stdio.length; ++i) {
                if (stdio[i] === 'pipe') {
                  this.ffmpeg.stdio[i].removeAllListeners('data');
                }
              }

              const { pid, killed } = this.ffmpeg;

              const message = `code: ${code}, signal: ${signal}, killed: ${killed}`;

              const status = 'close';

              this.status({ fill: 'red', shape: 'dot', text: message });

              this.send({ topic: topics[0], payload: { status, pid, code, signal, killed } });

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
                const topic = topics[i];

                const filename = outFilenames[i - 1] || undefined;

                const wires = [];

                this.ffmpeg.stdio[i].on('data', data => {
                  wires[i] = { topic, payload: data, filename };

                  this.send(wires);
                });
              }
            }
          }
        } catch (err) {
          this.error(err);

          this.status({ fill: 'red', shape: 'dot', text: err.toString() });
        }
      }
    }

    stop(killSignal) {
      if (this.running && this.ffmpeg instanceof ChildProcess) {
        const { pid, exitCode, signalCode } = this.ffmpeg;

        if (typeof pid === 'number' && exitCode === null && signalCode === null) {
          return new Promise((resolve, reject) => {
            this.ffmpeg.once('close', (code, signal) => {
              resolve();
            });

            killSignal = ['SIGHUP', 'SIGINT', 'SIGKILL', 'SIGTERM'].includes(killSignal) ? killSignal : this.killSignal;

            if (this.ffmpeg.kill(0) && !this.ffmpeg.stdin.destroyed) {
              this.ffmpeg.stdin.destroy();

              this.ffmpeg.kill(killSignal);

              // todo: kill again for stubborn ffmpeg process
            }
          });
        }
      }

      return Promise.resolve();
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
      if (!Number.isInteger(cmdOutputs) || cmdOutputs < 0 || cmdOutputs > cmdOutputsMax) {
        throw new Error(_('ffmpeg-spawn.error.cmd_outputs_invalid', { cmdOutputs }));
      }
    }

    createTopics() {
      const base = `ffmpeg_spawn/${this.id}/`;

      const topics = [`${base}status`];

      switch (this.cmdOutputs) {
        case 0:
          // do nothing

          break;

        case 1:
          topics.push(`${base}stdout`);

          break;

        case 2:
          topics.push(...[`${base}stdout`, `${base}stderr`]);

          break;

        default:
          topics.push(...[`${base}stdout`, `${base}stderr`]);

          for (let i = 3; i <= this.cmdOutputs; ++i) {
            topics.push(`${base}stdio${i}`);
          }
      }

      return topics;
    }

    createStdio() {
      const stdio = ['pipe'];

      switch (this.cmdOutputs) {
        case 0:
          stdio.push(...['ignore', 'ignore']);

          break;

        case 1:
          stdio.push(...['pipe', 'ignore']);

          break;

        default:
          for (let i = 0; i < this.cmdOutputs; ++i) {
            stdio.push('pipe');
          }

          break;
      }

      return stdio;
    }

    static jsonParse(str) {
      try {
        return JSON.parse(str);
      } catch (e) {
        return str;
      }
    }
  }

  if (typeof settings.ffmpegSpawn !== 'object') {
    settings.ffmpegSpawn = {};
  }

  const { ffmpegSpawn } = settings;

  ffmpegSpawn.cmdPath = /ffmpeg/i.test(ffmpegSpawn.cmdPath) ? ffmpegSpawn.cmdPath.trim() : 'ffmpeg';

  ffmpegSpawn.cmdOutputsMax = Number.isInteger(ffmpegSpawn.cmdOutputsMax) && ffmpegSpawn.cmdOutputsMax > 5 ? ffmpegSpawn.cmdOutputsMax : 5;

  const { cmdPath, cmdOutputsMax } = ffmpegSpawn;

  FfmpegSpawnNode.cmdPath = cmdPath;

  FfmpegSpawnNode.cmdOutputsMax = cmdOutputsMax;

  FfmpegSpawnNode.type = 'ffmpeg-spawn';

  FfmpegSpawnNode.settings = {
    settings: {
      ffmpegSpawn: {
        value: {
          cmdPath,
          cmdOutputsMax,
        },
        exportable: true,
      },
    },
  };

  registerType(FfmpegSpawnNode.type, FfmpegSpawnNode, FfmpegSpawnNode.settings);
};

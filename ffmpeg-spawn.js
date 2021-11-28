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

        this.stopping = false;

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

      if (this.stopping) {
        this.debug('FFmpeg is stopping. Try again later');

        return;
      }

      // needs to be a priority case if being used
      if (Buffer.isBuffer(payload) && this.running) {
        if (payload.length) {
          try {
            this.ffmpeg.stdin.write(payload);
          } catch (err) {
            this.debug(err);
          }
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

      await this.onInput({ action: { command: 'stop' } });

      // if (!this.stopping) {
      // await this.stop();
      // }

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

          const ffmpeg = spawn(cmdPath, cmdArgs, { stdio, env });

          ffmpeg.once('error', err => {
            this.error(err);

            const status = 'error';

            const error = err.toString();

            this.status({ fill: 'red', shape: 'dot', text: error });

            this.send({ topic: topics[0], payload: { status, error } });
          });

          const { pid } = ffmpeg;

          if (pid) {
            this.running = true;

            this.ffmpeg = ffmpeg;

            const status = 'spawn';

            const message = `pid: ${pid}`;

            this.status({ fill: 'green', shape: 'dot', text: message });

            this.send({ topic: topics[0], payload: { status, pid } });

            ffmpeg.once('close', async (code, signal) => {
              this.running = false;

              const { pid, killed } = ffmpeg;

              const status = 'close';

              const message = `code: ${code}, signal: ${signal}, killed: ${killed}`;

              this.status({ fill: 'red', shape: 'dot', text: message });

              this.send({ topic: topics[0], payload: { status, pid, code, signal, killed } });

              this.ffmpeg = undefined;
            });

            const { stdin } = ffmpeg;

            stdin.on('error', err => {
              this.debug(err);
            });

            stdin.once('close', () => {
              stdin.removeAllListeners('error');
            });

            if (Buffer.isBuffer(payload)) {
              stdin.write(payload);
            }

            for (let i = 1; i < stdio.length; ++i) {
              if (stdio[i] === 'pipe') {
                const topic = topics[i];

                const filename = outFilenames[i - 1] || undefined;

                const wires = [];

                const pipe = ffmpeg.stdio[i];

                pipe.on('data', data => {
                  wires[i] = { topic, payload: data, filename };

                  this.send(wires);
                });

                pipe.on('error', err => {
                  this.debug(err);
                });

                pipe.once('close', () => {
                  pipe.removeAllListeners('data');

                  pipe.removeAllListeners('error');
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
        const {
          ffmpeg,
          ffmpeg: { stdin, pid, exitCode, signalCode },
        } = this;

        killSignal = ['SIGHUP', 'SIGINT', 'SIGKILL', 'SIGTERM'].includes(killSignal) ? killSignal : this.killSignal;

        if (typeof pid === 'number' && exitCode === null && signalCode === null) {
          return new Promise(async (resolve, reject) => {
            const sigkillTimeout = setTimeout(() => {
              this.debug(`sigkill timeout`);

              if (ffmpeg instanceof ChildProcess && ffmpeg.kill(0)) {
                ffmpeg.kill('SIGKILL');
              }
            }, 2000);

            ffmpeg.once('close', () => {
              clearTimeout(sigkillTimeout);

              this.stopping = false;

              resolve();
            });

            stdin.once('close', () => {
              if (ffmpeg instanceof ChildProcess && ffmpeg.kill(0)) {
                ffmpeg.kill(killSignal);
              }
            });

            this.stopping = true;

            stdin.end();
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

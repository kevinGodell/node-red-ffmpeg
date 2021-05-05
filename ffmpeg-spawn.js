'use strict';

const jsonParse = require('./lib/jsonParse');

const { spawn, ChildProcess } = require('child_process');

module.exports = RED => {
  const {
    settings,
    _,
    nodes: { createNode, registerType },
  } = RED;

  if (typeof settings.ffmpegSpawn !== 'object') {
    settings.ffmpegSpawn = {};
  }

  const { ffmpegSpawn } = settings;

  ffmpegSpawn.cmdPath = /ffmpeg/i.test(ffmpegSpawn.cmdPath) ? ffmpegSpawn.cmdPath.trim() : 'ffmpeg';

  ffmpegSpawn.cmdOutputsMax = Number.isInteger(ffmpegSpawn.cmdOutputsMax) && ffmpegSpawn.cmdOutputsMax > 5 ? ffmpegSpawn.cmdOutputsMax : 5;

  const { cmdPath, cmdOutputsMax } = ffmpegSpawn;

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
      if (!Number.isInteger(cmdOutputs) || cmdOutputs < 0 || cmdOutputs > cmdOutputsMax) {
        throw new Error(_('ffmpeg-spawn.error.cmd_outputs_invalid', { cmdOutputs }));
      }
    }

    static validateCmdTopics(cmdTopics, cmdOutputs) {
      if (!Array.isArray(cmdTopics) || [...new Set(cmdTopics)].length !== cmdOutputs || cmdTopics.includes('status') || cmdTopics.some(topic => typeof topic !== 'string')) {
        throw new Error(_('ffmpeg-spawn.error.cmd_topics_invalid', { cmdTopics, cmdOutputs }));
      }
    }

    static createTopicsFromArray(array) {
      const topics = ['status'];

      topics.push(...array);

      return topics;
    }

    static createTopicsFromCount(count) {
      const topics = ['status'];

      switch (count) {
        case 0:
          // do nothing

          break;

        case 1:
          topics.push('stdout');

          break;

        case 2:
          topics.push(...['stdout', 'stderr']);

          break;

        default:
          topics.push(...['stdout', 'stderr']);

          for (let i = 3; i <= count; ++i) {
            topics.push(`stdio${i}`);
          }
      }

      return topics;
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

          let cmdOutputs;

          if (!this.splitOutput && typeof outputs !== 'undefined') {
            FfmpegSpawnNode.validateCmdOutputs(outputs); // throws

            cmdOutputs = outputs;
          } else {
            cmdOutputs = this.cmdOutputs;
          }

          let nodeTopics;

          if (!this.splitOutput && typeof topics !== 'undefined') {
            FfmpegSpawnNode.validateCmdTopics(topics, cmdOutputs); // throws

            nodeTopics = FfmpegSpawnNode.createTopicsFromArray(topics);
          } else {
            nodeTopics = FfmpegSpawnNode.createTopicsFromCount(cmdOutputs);
          }

          const stdio = FfmpegSpawnNode.createStdio(cmdOutputs);

          this.ffmpeg = spawn(cmdPath, cmdArgs, { stdio });

          this.ffmpeg.on('error', err => {
            this.error(err);

            const status = 'error';

            const error = err.toString();

            this.status({ fill: 'red', shape: 'dot', text: error });

            this.send({ topic: nodeTopics[0], payload: { status, error } });
          });

          const { pid } = this.ffmpeg;

          if (pid) {
            this.running = true;

            const message = `pid: ${pid}`;

            const status = 'spawn';

            this.status({ fill: 'green', shape: 'dot', text: message });

            this.send({ topic: nodeTopics[0], payload: { status, pid } });

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

              this.send({ topic: nodeTopics[0], payload: { status, pid, code, signal, killed } });

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
                const topic = nodeTopics[i];

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
  }

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

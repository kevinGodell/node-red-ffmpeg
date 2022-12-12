# @kevingodell/node-red-ffmpeg
######
[![GitHub license](https://img.shields.io/badge/license-MIT-brightgreen.svg)](https://raw.githubusercontent.com/kevinGodell/node-red-ffmpeg/master/LICENSE)
[![npm](https://img.shields.io/npm/dt/@kevingodell/node-red-ffmpeg.svg?style=flat-square)](https://www.npmjs.com/package/@kevingodell/node-red-ffmpeg)
[![GitHub issues](https://img.shields.io/github/issues/kevinGodell/node-red-ffmpeg.svg)](https://github.com/kevinGodell/node-red-ffmpeg/issues)

**A [Node-RED](https://nodered.org/) node used for spawning a long-running [ffmpeg](https://ffmpeg.org/) process to handle video/image processing.**

* designed to be a thin wrapper around ffmpeg using [child_process.spawn](https://nodejs.org/api/child_process.html#child_process_child_process_spawn_command_args_options)
* ffmpeg executable binary must be [installed](https://duckduckgo.com/?q=how+to+install+ffmpeg) or [built](https://duckduckgo.com/?q=how+to+build+ffmpeg) separately

### Expectations:
* You should have working knowledge of ffmpeg on the command line.
* If you have difficulties making it work, please open a new [discussion](https://discourse.nodered.org/) and tag me `@kevinGodell`.
* Do not send private messages asking for help because that will not benefit others with similar issues.

### Installation:
* go to the correct directory, usually ~/.node-red
```
cd ~/.node-red
```
* using npm
```
npm install @kevingodell/node-red-ffmpeg
```
* reboot the node-red server
```
node-red-stop && node-red-start
```

### Instructions:
* See the detailed help text in the sidebar.

### Screenshots:
<img width="500" alt="flow" src="https://user-images.githubusercontent.com/6091746/203855624-1ad8675b-e8e4-40d0-98db-79d765e84af6.png">
<img width="500" alt="properties" src="https://user-images.githubusercontent.com/6091746/203855748-802673c7-663d-499c-bce0-5357ed61579a.png">
<img width="500" alt="args" src="https://user-images.githubusercontent.com/6091746/203856008-f16f9a60-7512-4b4a-a532-65a1d4df9efc.png">
<img width="500" alt="help" src="https://user-images.githubusercontent.com/6091746/203855844-f05959c3-76ed-47d4-a8ed-0283cba3e595.png">

### Flows:
https://github.com/kevinGodell/node-red-ffmpeg/tree/master/examples

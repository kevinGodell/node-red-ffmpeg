# @kevingodell/node-red-ffmpeg

**A [Node-RED](https://nodered.org/) node used for spawning a long-running [ffmpeg](https://ffmpeg.org/) process to handle video/image processing.**

* designed to be a thin wrapper around ffmpeg using [child_process.spawn](https://nodejs.org/api/child_process.html#child_process_child_process_spawn_command_args_options)
* ffmpeg executable binary must be [installed](https://duckduckgo.com/?q=how+to+install+ffmpeg) or [built](https://duckduckgo.com/?q=how+to+build+ffmpeg) separately

### Expectations:
* You should have working knowledge of ffmpeg on the command line.
* If you have difficulties making it work, please open a new [discussion](https://discourse.nodered.org/) and tag me `@kevinGodell`.
* Please, do not send private messages asking for help because that will not benefit others with similar issues.

### Installation:
* go to the correct directory, usually ~/.node-red
```
cd ~/.node-red
```
* using npm
```
npm install @kevingodell/node-red-ffmpeg
```
* using yarn
```
yarn add @kevingodell/node-red-ffmpeg
```
* reboot the node-red server
```
node-red-stop && node-red-start
```

### Instructions:
* See the detailed help text in the sidebar.

### Screenshots:
Coming soon...

### Flows:
Coming soon...

# migo-web-adapter

[English](README.md) | [中文](README.zh-CN.md)

一个浏览器风格的 BOM/DOM 适配层，构建在 [migo](https://github.com/minigame-labs/migo) 小游戏运行时之上。让为浏览器式环境编写的游戏（Cocos Creator、Egret、Laya、Pixi、原生 WebGL）无需改动即可在 migo 上运行，方式是把 `window.*`、`document.*`、`Image`、`XMLHttpRequest` 等映射到对应的 `migo.*` API 上。

migo 运行时刻意**不内置 BOM/DOM**——它只提供 `migo.*` 加标准 JavaScript。浏览器风格的全局对象是这个适配层的职责。如果你的内容是 wx 形态的（直接调用 `wx.*`），请看 [`migo-wx-adapter`](https://github.com/minigame-labs/migo-wx-adapter)——两者可以自由组合，因为它们各自只碰互不重叠的全局对象。

## 什么时候需要它

- 你的游戏使用浏览器全局对象（`document.createElement`、`new Image()`、`window.innerWidth`、`XMLHttpRequest`、`localStorage`、`WebSocket` 等）。
- 你的引擎是基于浏览器式环境构建的（Cocos / Egret / Laya / Pixi / Phaser / Three.js / 自研 WebGL 技术栈）。
- 你想以最小改动把一个 wx 风格的游戏搬到 migo 上运行。

如果你的游戏只直接调用 `migo.*` API（不用 `window`，不用 `document`），你不需要这个适配层。

## 安装

这个适配层是纯 ESM 源码——不需要构建步骤。

```js
// 游戏入口,在引擎启动之前
import "@minigame-labs/migo-web-adapter";
// 或者，使用 require/AMD 加载器:
require("./src/index.js");
```

适配层通过 `globalThis.__migoWebAdapterInjected` 检测重复引入，重复 import 两次是安全的。

### 通过运行时启动前置脚本实现零改动测试

如果你有一个第三方的浏览器风格游戏，它**没有**引入这个适配层，而你也不想（或不能）修改它的源码，migo 运行时可以把这个适配层作为*启动前置脚本（boot prelude script）*注入进去。先构建一次 IIFE 打包产物，再通过 `InitOptions::with_prelude_script` 喂给运行时。

构建打包产物:

```sh
npm run build
# → dist/migo-web-adapter.bundle.js
```

接入运行时（Rust 端，例如桌面启动器或 Android JNI 引导代码）:

```rust
let bundle = std::fs::read_to_string("path/to/migo-web-adapter.bundle.js")?;
let init = InitOptions::new()
    .with_prelude_script("<migo-web-adapter>", bundle)
    // ... other options
    ;
// then EvaluateModule the game's entry as usual
```

在 Android 上，通过 `RuntimeConfig.Builder` 配置:

```java
String bundle = readAssetAsString(context, "migo-web-adapter.bundle.js");
RuntimeConfig config = new RuntimeConfig.Builder(context)
        .addPreludeScript("<migo-web-adapter>", bundle)
        .build();
```

把 `migo-web-adapter.bundle.js` 放进你 App 的 `assets/` 目录，这样宿主 App 就能在启动时读取一次，并把源码传给 builder。

前置脚本会在每次 `EvaluateModule` 之前运行在全局作用域中，所以游戏能看到 `window.innerWidth`、`document.createElement`、`Image`、`XMLHttpRequest` 等已经就绪。多次调用 `with_prelude_script` 会按声明顺序累积并依次执行；同一个 `__migoWebAdapterInjected` 哨兵值，使得这个打包产物可以安全地与一个*同时也*引入了 ESM 入口的游戏组合使用。

## `globalThis` 上暴露了什么

| 类别 | 名称 |
|---|---|
| BOM 标量 | `innerWidth`、`innerHeight`、`outerWidth`、`outerHeight`、`screenWidth`、`screenHeight`、`devicePixelRatio` |
| BOM 对象 | `screen`、`navigator`、`location`、`document`、`localStorage` |
| Window 自引用 | `window`、`self`、`parent`、`top` |
| 构造函数 / 类 | `Image`、`Audio`、`XMLHttpRequest`、`WebSocket`、`FileReader`、`HTMLElement`、`Element`、`Node`、`EventTarget`、`Event`、`TouchEvent`、`MouseEvent`、`DeviceMotionEvent`、`GamepadEvent`、`HTMLImageElement`、`HTMLCanvasElement`、`HTMLAudioElement`、`HTMLMediaElement`、`HTMLVideoElement` |
| 屏上画布 | `globalThis.canvas`(也可通过 `document.getElementById("GameCanvas")` 获取) |

## 与 `migo.*` 的映射关系

| 浏览器 API | migo 运行时调用 |
|---|---|
| `window.innerWidth` / `screen.width` / `devicePixelRatio` | `migo.getWindowInfo()`(适配层加载时的一次性快照;赋值会保留，宿主 resize 不会覆盖它——详见下方"BOM 语义"） |
| `navigator.userAgent` / `navigator.platform` | 由 `migo.getSystemInfoSync()` 派生 |
| `document.createElement('canvas')` / `new Canvas()` | `migo.createCanvas()` |
| `document.createElement('img')` / `new Image()` | `migo.createImage()` |
| `new Audio(src)` | `migo.createInnerAudioContext()` |
| `localStorage.{getItem, setItem, removeItem, clear}` | `migo.{get, set, remove, clear}StorageSync` |
| `new XMLHttpRequest()` | `migo.request()` |
| `new WebSocket(url)` | `migo.connectSocket()` |
| 在 `window`、`document`、`canvas` 上 `addEventListener('touchstart' …)` | `migo.onTouchStart` / `onTouchMove` / `onTouchEnd` / `onTouchCancel` |
| `navigator.getGamepads()` | `migo.getGamepads()`——直接转发，因此返回的手柄对象在帧与帧之间保持同一身份 |
| 在 `window` 上 `addEventListener('gamepadconnected' / 'gamepaddisconnected')` | `migo.onGamepadConnected` / `migo.onGamepadDisconnected` |

## BOM 语义

`window.innerWidth`、`innerHeight`、`screen`、`devicePixelRatio` 等，是适配层加载时对宿主窗口指标的**一次性快照**，作为普通的可写数据属性暴露在 `globalThis` 上。这与规范的小游戏适配层行为一致，但和真实浏览器不同:

- 可以 `window.innerWidth = X`，赋值会生效并保留。
- 这些值在游戏启动所在的屏幕上是正确的。
- 适配层**不会**订阅宿主的 resize 事件——如果窗口尺寸发生变化（旋转、可折叠屏幕展开、输入法弹出），`window.innerWidth` **不会**自动更新。

需要实时指标的游戏应该直接调用 `migo.getWindowInfo()`（例如在自己的 resize 监听器里，或者每帧调用一次）。适配层刻意不介入这部分，避免引擎内部的布局缓存与适配层的写入互相竞争。

## 这个适配层不是什么

- **不是完整的 DOM**。我们只提供一个基础的 `Node`/`Element`/`HTMLElement` 树，深度刚好够引擎启动阶段的调用（`appendChild`、`parentNode`、`setAttribute`、`getBoundingClientRect`）不会抛错。我们不运行真正的布局引擎，不做 CSS 选择器匹配，不解析 HTML。`document.querySelector`、`getElementsByTagName` 等会返回空结果。
- **不是完整的浏览器网络栈**。`XMLHttpRequest` 和 `WebSocket` 覆盖了引擎常见的代码路径，但不支持 CORS、cookie、响应流、`Blob` 与 `FormData`。
- **不是完整的 WebAudio**。`new Audio(src)` 会桥接到 `migo.createInnerAudioContext`。`AudioContext` 图（振荡器、滤波器等）由 migo 运行时直接在 `globalThis.AudioContext` 下提供，不是由这个适配层提供的。
- **不是真正的 `FileReader`**。我们支持针对简单输入（`string`、`ArrayBuffer`）的 `readAsText`/`readAsArrayBuffer`/`readAsDataURL`。不支持 `Blob` 流式读取。

如果你需要以上任何一项，欢迎扩展这个适配层——源码很小，是 ESM，且没有依赖。

## 目录结构

```
src/
  index.js          入口 — 把所有东西挂到 globalThis 上
  bom.js            innerWidth / innerHeight / screen / devicePixelRatio
  gamepad.js        基于 migo 手柄传输层实现的 W3C Gamepad API
  navigator.js      navigator 桩实现
  location.js       location 桩实现
  document.js       document 对象(createElement、getElementById 等)
  element.js        Node / Element / HTMLElement 及各标签对应的子类
  event-target.js   EventTarget 基类
  events.js         Event / TouchEvent / MouseEvent / DeviceMotionEvent
  image.js          Image() 构造函数 → migo.createImage
  canvas.js         Canvas() 构造函数 → migo.createCanvas
  audio.js          Audio() 构造函数 → migo.createInnerAudioContext
  local-storage.js  基于 migo.*StorageSync 实现的 localStorage
  xhr.js            基于 migo.request 实现的 XMLHttpRequest
  websocket.js      基于 migo.connectSocket 实现的 WebSocket
  file-reader.js    FileReader 的简单实现
scripts/
  build-bundle.mjs  esbuild → dist/migo-web-adapter.bundle.js (IIFE;用于前置脚本注入)
tests/
  adapter.test.mjs  针对一个伪造 migo 运行时的 Node 模拟测试
  bundle.test.mjs   在 vm.Context 中对 IIFE 打包产物做冒烟测试
```

## 运行测试

```sh
node tests/adapter.test.mjs
node tests/bundle.test.mjs
# or
npm test                 # runs both
npm run build && npm test  # rebuild bundle then test
```

ESM 测试会给 `globalThis.migo` 打桩为一个伪造的运行时，引入适配层，
并对 BOM/DOM/事件/网络行为做端到端断言。打包产物测试会在
`vm.Context` 中针对 `dist/migo-web-adapter.bundle.js` 重跑一个精简子集，
以确认这份 IIFE 注入的能力面与 ESM 版本一致。

## 许可证

MIT

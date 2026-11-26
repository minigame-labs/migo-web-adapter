# migo-web-adapter

[English](README.md) | [中文](README.zh-CN.md)

一个浏览器风格的 BOM/DOM 适配层，构建在 [migo](https://github.com/minigame-labs/migo-runtime) 小游戏运行时之上。让为浏览器式环境编写的游戏在 migo 上运行，方式是把 `window.*`、`document.*`、`Image`、`XMLHttpRequest` 等映射到对应的 `migo.*` API 上。

migo 运行时刻意**不内置 BOM/DOM**——它只提供 `migo.*` 加标准 JavaScript。浏览器风格的全局对象是这个适配层的职责。如果你的内容是 wx 形态的（直接调用 `wx.*`），请看 [`migo-wx-adapter`](https://github.com/minigame-labs/migo-wx-adapter)——两者可以自由组合，因为它们各自只碰互不重叠的全局对象。

## 什么时候需要它

- 你的游戏使用浏览器全局对象（`document.createElement`、`new Image()`、`window.innerWidth`、`XMLHttpRequest`、`localStorage`、`WebSocket` 等）。
- 你的引擎是基于浏览器式环境构建的（Pixi / Phaser / three.js / Babylon.js / PlayCanvas / 自研 WebGL 技术栈:实际跑过哪些见下面的**已验证的引擎**）。
- 你想以最小改动把一个 wx 风格的游戏搬到 migo 上运行。

如果你的游戏只直接调用 `migo.*` API（不用 `window`，不用 `document`），你不需要这个适配层。

## 已验证的引擎

下面列出的全部由 conformance 的 `engines/` 套件在真实 macOS 宿主上原样运行验证(版本固定;场景绘制已知颜色并读回像素、回放点击与拖拽、从游戏包加载资源、播放声音)。

| 引擎 | 版本 | 检查内容 |
|---|---|---|
| Pixi | 7.4.3 | 渲染(图形、精灵、文本、渲染纹理)、ticker、指针事件 |
| Phaser | 3.90.0 | 渲染、场景输入(`pointerdown` 落在点击的精确位置)、加载器(图片、精灵表、JSON、文本、音频、缺失文件)、声音播放到 `complete` 事件 |
| three.js | 0.186.1 | 渲染、阴影、MSAA 目标、PMREM 环境、实例化、蒙皮、深度纹理、多渲染目标、OrbitControls、FileLoader / TextureLoader / AudioLoader / GLTFLoader |
| Babylon.js | 9.29.0 | 渲染、光照场景、动态纹理、指针拾取 |
| PlayCanvas | 2.22.6 | 渲染、触摸输入 |
| Howler.js | 2.2.4 | 经 WebAudio 与 `<audio>` 元素两条路径加载、解码、播放并结束声音 |
| Egret | 5.4.1 | 渲染(图形、透明度与混合模式、变换、滚动矩形、canvas 纹理与文件纹理、文本)、经 `DOMParser` 读取的 XML 资源、帧时钟驱动的缓动 |

Cocos Creator 和 Laya **不在**该套件中:它们自带平台胶水代码,这里没有验证过,因此本 README 不对它们做任何声明。Egret 在 macOS 与 iPhone 12(Performance+)上运行;其引擎文件不在 npm 上,套件按 commit 与 sha256 固定(`engines/vendor/egret.pin`)。

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
| Window 自引用 | `window`、`self`、`parent`、`top`；全局对象是一个 `Window`（`window instanceof Window` 为真；它是接口，构造函数会抛错），`focus()` / `blur()` 不做任何事：游戏窗口始终是聚焦的那个 |
| 构造函数 / 类 | `Image`、`Audio`、`XMLHttpRequest`、`WebSocket`、`FileReader`、`HTMLElement`、`Element`、`Node`、`EventTarget`、`Event`、`TouchEvent`、`MouseEvent`、`WheelEvent`、`KeyboardEvent`、`CompositionEvent`、`DeviceMotionEvent`、`GamepadEvent`、`HTMLImageElement`、`HTMLCanvasElement`、`HTMLAudioElement`、`HTMLMediaElement`、`HTMLVideoElement` |
| 屏上画布 | `globalThis.canvas`(也可通过 `document.getElementById("GameCanvas")` 获取) |
| Audio 元素 | `new Audio(src)`;`canPlayType` 按运行时能解码的格式作答(PCM WAV、MP3、Ogg Vorbis:`"probably"` / `"maybe"` / `""`),`play()` 返回 promise |
| 资源加载 | `XMLHttpRequest`(异步)与 `fetch` / `Headers` / `Request` / `Response`,支持三类 URL:网络(`migo.request`)、`data:` 与 `blob:`,以及**游戏包**——相对路径(`assets/a.json`、`./a.png?v=3`)或源相对路径(`/assets/a.json`)都读取包内文件,文件不存在是一次已完成的请求,状态 404。`Blob` / `File`、`URL.createObjectURL`(`Image` 可以加载它)、`createImageBitmap(blob)`、`FileReader`、`TextEncoder` / `TextDecoder`(UTF-8、UTF-16LE、windows-1252、GBK)、`AbortController` / `AbortSignal`;`EventTarget` 支持 `once`、`signal` 与 `handleEvent` 对象。`fetch` 的响应没有 `body` 流,流式读取的库据此得知只能整体读取 |
| DOM 指针 | `PointerEvent`(`pointerId`、`pointerType`、`isPrimary`、`pressure`、`width/height` 等);`setPointerCapture` / `releasePointerCapture` / `hasPointerCapture` |
| DOM 触摸 | `Touch`(`identifier`、`target`、`clientX/Y`、`pageX/Y`、`screenX/Y`、`radiusX/Y`、`rotationAngle`、`force`);`TouchEvent` 的 `touches` / `targetTouches` / `changedTouches` 带 `item(i)` |
| XML | `DOMParser` 与 `XMLSerializer`,用于 XML(`text/xml`、`application/xml`、`application/xhtml+xml`、`image/svg+xml`):文档、带属性与命名空间的元素、文本、CDATA、注释与处理指令;格式不合法的文档返回 `<parsererror>` 根节点,与浏览器一致。`text/html` 被拒绝(`NotSupportedError`)。Egret 在加载时创建解析器并用它读取全部 XML 资源;Cocos 与 Laya 用同一对接口读取 `.fnt`、`.tmx` 与 `.plist` |
| 网页字体 | `new FontFace(family, source, descriptors)`——`source` 是 CSS 的 `src` 列表(`url(...) format(...)`,按顺序尝试;`local(...)` 跳过)或字体字节——以及 `load()`、`loaded`、`status`;`document.fonts`(`FontFaceSet`:`add`、`delete`、`has`、`clear`、迭代、`load(font)`、`check(font)`、`ready`、`status`,`loading` / `loadingdone` / `loadingerror` 事件)。字体在加载时以其 family 经 `migo.loadFont` 注册(TTF、OTF、WOFF、WOFF2):包内 URL 直接按路径,网络、`data:`、`blob:` URL 或字节经临时文件。已加载的字体不论是否在 `document.fonts` 里都能用于绘制,`delete` 也不会注销它 |
| 脚本与页面地址 | 包内的 `<script src>` 按 HTML 脚本元素的规则执行：读不到的触发 `error` 且不执行；执行时抛出的异常会上报，`load` 照常触发；处理函数或监听器抛出的异常也会上报。适配层里任何监听器抛出的异常都经运行时的 `reportError` 上报（游戏的 `onError` 能收到，相当于页面的 `window.onerror`），其后的监听器照常执行。`location.href` 与 `document.URL` 为绝对地址 `https://game/game.js` |
| IndexedDB | `indexedDB`（带版本的 `open`、`upgradeneeded` 与 `blocked`、`deleteDatabase`、`databases`、`cmp`）以及 `IDBDatabase`、`IDBTransaction`、`IDBObjectStore`、`IDBIndex`（unique、multiEntry）、`IDBCursor` / `IDBCursorWithValue`（各方向、`continue`、`continuePrimaryKey`、`advance`、`update`、`delete`）、`IDBKeyRange`、`IDBRequest`、`IDBVersionChangeEvent`：值按结构化序列化保存（每次读取都是新副本），键按规范排序，支持键生成器，错误未被取消时中止事务并撤销其修改。每个数据库的事务按顺序逐个执行；事务在创建它的任务及其请求的事件中处于活动状态。数据库保存在游戏的用户数据目录（`<USER_DATA_PATH>/.indexeddb/`），每个修改过它的事务提交后写入并改名覆盖旧文件。Unity 构建把持久数据路径挂在它上面（emscripten 的 IDBFS），没有它会直接 abort |
| 尺寸观察 | `ResizeObserver`（`observe` 可带 `box`、`unobserve`、`disconnect`）和 `ResizeObserverEntry`（`contentRect`、`contentBoxSize`、`borderBoxSize`、`devicePixelContentBoxSize`）：在一帧的动画回调之后、绘制之前投递，尺寸取元素的 `getBoundingClientRect()`；元素被观察时若有尺寸即上报，之后每次尺寸变化再上报；窗口 resize 会触发一次检查。Kaplay 和 Excalibur 靠它确定视图尺寸 |
| 图片即元素 | `new Image()` 是带属性的元素（`setAttribute` / `getAttribute` / `removeAttribute` / `hasAttribute` / `getAttributeNames`；`src`、`id`、`class`、`crossorigin`、`data-*` 与属性同步），`instanceof HTMLImageElement` 为真。Excalibur 把图片的过滤与环绕方式存为属性 |
| 屏幕方向 | `screen.orientation` 是 `ScreenOrientation`：一个 `EventTarget`，`type` 跟随窗口，`angle` 相对设备的自然方向（手机和平板为竖屏、桌面为横屏），窗口转向时触发 `change`，`lock()` 为 `NotSupportedError`（锁定方向由平台负责，不由页面负责），`unlock()` 不做任何事 |
| 流 | `ReadableStream`(默认 reader、底层源的 start / pull / cancel、`tee`、异步迭代)以及基于它的 `Response.body` / `Request.body`:边到达边读取的 body,和由流构成的 body(Godot 的 web 加载器、three.js 的 FileLoader);克隆流式 body 时做 tee。`ProgressEvent`。`isSecureContext` 为 true(页面源是 `https://game`),`crossOriginIsolated` 为 false |
| Migo 的 V8 没有的标准全局 | `atob`、`btoa`(HTML 标准 base64,输入非法时抛 `InvalidCharacterError`)、`DOMException`(name、message、旧式 `code`)。宿主自带时不覆盖 |

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
| `new FontFace(...).load()` / `document.fonts.load(font)` | `migo.loadFont()` |
| 在 `window`、`document`、`canvas` 上 `addEventListener('touchstart' …)` | `migo.onTouchStart` / `onTouchMove` / `onTouchEnd` / `onTouchCancel` |
| 在 `window`、`document`、`canvas` 上 `addEventListener('mousedown' / 'mousemove' / 'mouseup' / 'click')` | `migo.onMouseDown` / `onMouseMove` / `onMouseUp`，合成为 W3C 触摸兼容鼠标事件（若配对的触摸调用了 `preventDefault()` 则会被抑制） |
| 在 `window`、`document`、`canvas` 上 `addEventListener('wheel')` | `migo.onWheel` |
| 在 `window`、`document` 上 `addEventListener('keydown' / 'keyup')` | `migo.onKeyDown` / `migo.onKeyUp` |
| 在 `window`、`document` 上 `addEventListener('compositionstart' / 'compositionupdate' / 'compositionend')` | `migo.onCompositionStart` / `onCompositionUpdate` / `onCompositionEnd`（IME） |
| `document.hidden` / `addEventListener('visibilitychange')` | `migo.onShow` / `migo.onHide` |
| `navigator.getGamepads()` | `migo.getGamepads()`——直接转发，因此返回的手柄对象在帧与帧之间保持同一身份 |
| 在 `window` 上 `addEventListener('gamepadconnected' / 'gamepaddisconnected')` | `migo.onGamepadConnected` / `migo.onGamepadDisconnected` |

## 哪个画布会被显示

Migo 只呈现一个画布:`globalThis.canvas`(也可用 `document.getElementById("GameCanvas")` 取到),即运行时创建的第一个画布。画在别的画布上的内容只是一块没人看见的离屏缓冲;浏览器教程里的 `document.body.appendChild(canvas)` 并不会告诉引擎这一点。

- **文档就绪之后才运行的代码**(DOMContentLoaded 及以后:Phaser 在这时启动,`load` 回调里的代码也是):引擎用 `document.createElement('canvas')` 创建的第一个画布,只要屏幕画布还没被占用,*就是*屏幕画布。默认配置的 Phaser 游戏直接可用。
- **脚本加载期间运行的代码**(顶层):此时创建的画布被当作特性探测画布,是离屏的。请把 Migo 显示的那块画布传给引擎,每个引擎一行,[conformance 的 `engines/` 套件](https://github.com/minigame-labs/migo-conformance/tree/master/engines)跑的正是这些写法:

```js
const canvas = globalThis.canvas;                                  // 被呈现的那块
new Phaser.Game({ type: Phaser.WEBGL, canvas, width: canvas.width, height: canvas.height, scene });
new PIXI.Application({ view: canvas, width: canvas.width, height: canvas.height });
new THREE.WebGLRenderer({ canvas });
new BABYLON.Engine(canvas, true);
new pc.Application(canvas, { graphicsDeviceOptions: { deviceTypes: ['webgl2'] } });
```

触摸会以 DOM `TouchEvent` 的形式送达画布、`document` 和 `window`,其中 `Touch` 对象带有 `target`(画布)、`screenX/Y` 和接触椭圆;Phaser 场景级的 `input.on('pointerdown')` 依赖这个 `target`。

**Pointer Events。** `PointerEvent` 存在,每个触摸和鼠标事件之前都会先收到它的指针事件,顺序按规范:`pointerover`、`pointerenter`、`pointerdown`,然后才是 `touchstart`/`mousedown`;`pointermove`;`pointerup`、`pointerout`、`pointerleave`;`pointercancel`。触摸的 `pointerType` 是 `"touch"`,id 为宿主的 identifier + 2,最先按下的接触是 primary;鼠标是指针 1。取消 `pointerdown` 会阻止该接触的兼容鼠标事件(不影响 `click`),与浏览器一致。所有元素都有 `setPointerCapture` / `releasePointerCapture` / `hasPointerCapture`(接触结束时捕获自动释放)。Babylon.js 和 three.js 的 OrbitControls 只监听指针事件;Pixi 在 `PointerEvent` 存在时切换到指针事件。画布还拥有浏览器画布一定有的元素成员(`focus`、`blur`、`tagName`、`ownerDocument`、`isConnected` 等),因为 Babylon 的 pointer-down 处理函数以 `canvas.focus()` 结尾;Migo 做不到的(`requestPointerLock`、`requestFullscreen`)保持缺失,让特性检测保持诚实。

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
  location.js       页面地址（绝对地址，位于游戏的源上）
  report.js         HTML 的报告异常，经运行时的 reportError
  screen-orientation.js  screen.orientation
  idb/              IndexedDB：keys.js（键、键路径、键范围）、clone.js（结构化序列化）、api.js
  document.js       document 对象(createElement、getElementById 等)
  element.js        Node / Element / HTMLElement 及各标签对应的子类
  event-target.js   EventTarget 基类
  events.js         Event / TouchEvent / MouseEvent / WheelEvent / KeyboardEvent / CompositionEvent / DeviceMotionEvent
  image.js          Image() 构造函数 → migo.createImage
  canvas.js         Canvas() 构造函数 → migo.createCanvas
  audio.js          Audio() 构造函数 → migo.createInnerAudioContext
  local-storage.js  基于 migo.*StorageSync 实现的 localStorage
  xhr.js            基于 migo.request 实现的 XMLHttpRequest
  websocket.js      基于 migo.connectSocket 实现的 WebSocket
  file-reader.js    FileReader 的简单实现
  intl.js           最小化的 Intl polyfill（仅在 globalThis.Intl 缺失时发布）
scripts/
  build-bundle.mjs  esbuild → dist/migo-web-adapter.bundle.js (IIFE;用于前置脚本注入)
tests/
  adapter.test.mjs             针对一个伪造 migo 运行时的 Node 模拟测试
  gamepad.test.mjs             针对真实运行时传输层的 W3C Gamepad API 测试(测试时读取引擎源码)
  bundle.test.mjs              在 vm.Context 中对 IIFE 打包产物做冒烟测试
  pointer-compat.test.mjs      触摸 + W3C 兼容鼠标事件转发
  keyboard-events.test.mjs     物理键盘 → DOM keydown/keyup 转发
  composition-events.test.mjs  IME 组合输入 → DOM compositionstart/update/end 转发
  visibility-events.test.mjs   应用生命周期 → DOM Page Visibility(document.hidden、visibilitychange)
```

## 运行测试

```sh
node tests/adapter.test.mjs
node tests/gamepad.test.mjs
node tests/bundle.test.mjs
node tests/pointer-compat.test.mjs
node tests/keyboard-events.test.mjs
node tests/composition-events.test.mjs
node tests/visibility-events.test.mjs
# or, all seven at once — `npm test` also rebuilds dist/migo-web-adapter.bundle.js
# first via the `pretest` script
npm test
```

`adapter.test.mjs` 给 `globalThis.migo` 打桩为一个伪造的运行时，引入适配层，
并对 BOM/DOM/事件/网络行为做端到端断言;其余的 ESM 测试各自针对一个行为领域
(手柄、指针/鼠标兼容、键盘、IME 组合输入、页面可见性)做同样的事情。
`bundle.test.mjs` 会在 `vm.Context` 中针对 `dist/migo-web-adapter.bundle.js`
重跑一个精简子集，以确认这份 IIFE 注入的能力面与 ESM 版本一致。

## 许可证

MIT

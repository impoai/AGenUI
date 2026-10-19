# AGenUI for WebAssembly

This experimental platform port runs AGenUI's **real C++ core and Yoga 2.0.0**
in a browser or Electron renderer. It does not reimplement A2UI parsing or data
binding in JavaScript. The Impo fork adds this platform alongside upstream iOS,
Android and HarmonyOS. It does not change Impo's deployed apps.

Baseline: upstream `5c347a8352c1afff31879bcf5af4101df4f94137` (AGenUI 1.7.0).

## Build and run

Prerequisites: Node.js 22+, CMake 3.24+, Ninja, Python 3.10+, and
[Emscripten](https://emscripten.org/docs/getting_started/downloads.html) **6.0.12**.
Activate that SDK and source its `emsdk_env.sh` before building. Run from the
repository root:

```sh
npm run build:web
npm run test:web
npm run dev:web
```

Open **http://127.0.0.1:4188/**. Edit Destination, the checkbox and Days away,
then select **Plan this trip**. The action panel shows the C++ core's resolved
values. **Send server update** exercises the reverse path; **Switch theme**
asks the shared core to resolve its dark/light styles again. Resize the window
to recalculate Yoga layout.

No npm install is needed for this port. CMake downloads a commit-pinned Yoga
source on the first build. `platforms/web/dist/` contains `agenui.wasm`, its ES
module loader, JavaScript adapters, TypeScript declarations, styles and notices.
Only a completed build replaces the previous distribution.

To create a local installable package after building:

```sh
npm pack ./platforms/web --pack-destination /tmp
```

The package is not published to npm. CI builds and tests it and retains the
compiled distribution as an artifact. The original upstream mobile releases
are unchanged.

## Architecture

```text
A2UI v0.9 text chunks
    │
    ▼
Shared core/src C++ + Yoga, compiled by Emscripten
  parser → data model / bindings → component tree → layout → diffs
    │                                                     ▲
    ▼                                                     │
Web bridge → JavaScript session snapshots             values / actions
    │                                                     │
    ▼                                                     │
Reference DOM renderer or your application's component adapter
```

The Web build replaces the native worker-thread scheduler with an asynchronous,
ordered browser event queue. Core source for parsing, bindings, functions, style
resolution, diffing and layout is shared unchanged. The only shared-source edit
is an explicit `<cstdarg>` include needed for portable logger compilation.
The mobile build scripts do not reference the Web scheduler.

This initial port runs on the browser main thread. It needs neither
`SharedArrayBuffer` nor COOP/COEP headers. It is not a background-worker or
multithreaded implementation; large inputs can occupy the UI thread. Host
callbacks run in microtasks after core callbacks return, avoiding reentry while
internal locks are held. Component measurements must be synchronous.

## Use with the reference renderer

```js
import { createRuntime } from '@impoai/agenui-web';
import { createDOMRenderer } from '@impoai/agenui-web/dom';
import '@impoai/agenui-web/styles.css';

const runtime = await createRuntime({
  // Set wasmURL if your bundler relocates the binary. Otherwise it sits next
  // to agenui.mjs. Serve it as application/wasm over HTTP(S).
  onError: console.error,
});
const renderer = createDOMRenderer(runtime, document.querySelector('#card'), {
  onAction: message => console.log(message.action),
});
renderer.render(a2uiJSONL);

// For a decoded streaming source:
renderer.session.begin();
for await (const chunk of source) renderer.session.push(chunk);
renderer.session.end();

// When unmounting:
renderer.dispose();
runtime.dispose();
```

The default loader is an ES module. Configure a bundler to copy the `.wasm`
asset, or pass its emitted URL. When a CSP is used, the host must permit Wasm
compilation (usually `script-src 'self' 'wasm-unsafe-eval'`). Generated content
requires no `unsafe-eval`, account credentials or network permission.

One DOM renderer owns one runtime because measurement registrations belong to
the core engine. A renderer can contain multiple surfaces. For several renderer
containers, use separate runtimes. The lower-level API supports multiple isolated
sessions within one runtime when they share a measurement implementation.

## Supported reference components

| Components | Initial behavior |
| --- | --- |
| Column, Row, Card, List | Child containers positioned using core Yoga results |
| Text | Plain text, heading roles, wrapping and selected core text styles |
| Icon | Text fallback for the icon name; no icon asset library is bundled |
| Divider | Separator |
| Button | Accessible button; core resolves the action context on activation |
| TextField | Single-line text input with label and two-way value binding |
| CheckBox | Boolean input with label and two-way binding |
| Slider | Numeric input with label, value and keyboard controls |

This is not full native component parity. TextField's multiline/password
variants, Image, media, ChoicePicker, DateTimeInput, Tabs, Modal, Table,
Carousel, RichText, Markdown, Chart, Lottie and embedded Web content are not
implemented by the reference adapter. Unsupported components report a host
error and an unavailable placeholder where layout provides space. The adapter
does not claim support merely because the C++ core accepts a component name.

The adapter maps a selected set of paint styles (text and background colors,
font size/weight, line height, borders, radius, opacity and visibility). Core
layout coordinates are applied directly; arbitrary CSS is not injected.
Native fonts, input behavior, text measurement and unsupported paint styles
can still differ between platforms. Shared core logic does not imply
pixel-identical rendering.

## Custom components and framework integration

Pass `components` to `createDOMRenderer` to replace or add a component factory.
Factories return an element, an `update(snapshot)` function and optionally a
`childrenElement` and `dispose()`. The factory receives `change(values)` and
`action()` functions that route through C++; it never needs to resolve bindings.
It also receives `measuring`, which is true for temporary offscreen measurements.
Factories must not perform side effects while measuring. Supply `measure[type]`
for an explicit measurement implementation when needed.

```js
const renderer = createDOMRenderer(runtime, host, {
  components: {
    Badge: ({ document }) => {
      const element = document.createElement('span');
      element.className = 'agenui-node';
      return {
        element,
        update(node) { element.textContent = String(node.label ?? ''); },
      };
    },
  },
  measure: { Badge: () => ({ width: 160, height: 64 }) },
});
```

For React, Astryx or another component library, consume `runtime.createSession()`
directly, register component measurements, subscribe to core events and render
`session.surfaces`. There is no dependency on React or Astryx in this library.
`session.change(surfaceId, componentId, { value })` sends input back to the core;
`session.action(surfaceId, componentId)` asks the core to resolve its stored
action. Do not reconstruct action context from a stale UI snapshot.

All lower-level sizes use A2UI units: **2 units per CSS pixel**, matching the
native bridge's logical scale. DOM measurements convert CSS sizes to A2UI units;
layout positions and supported pixel style values convert back. Measurement
modes are Yoga's `0` (undefined), `1` (exactly), and `2` (at most).

## Boundaries and validation

- Feed decoded text chunks. Use streaming `TextDecoder` for network bytes;
  do not split a UTF-16 surrogate pair manually. Each reception round is bounded
  to 1,048,576 UTF-16 code units. Memory growth is capped at 256 MiB.
- This is a rendering SDK, not an authorization or untrusted-code sandbox.
  Validate the component catalog and input limits in the host. The reference
  adapter never interprets text as HTML and does not fetch generated URLs.
  Custom components remain responsible for their own security policy.
- Built-in core functions run in C++. Host/native function registration and
  filesystem-backed templates are not exposed by this initial Web API.
- There is no persistence or agent transport. The host owns messages, replay,
  action admission and unsent form state. Disposal drops local state and blocks
  later callbacks.
- Node tests execute the actual compiled Wasm, including fragmented input,
  Unicode, edits/actions, server updates, Yoga resize, custom measurements,
  themes, deletion, session isolation and teardown. These are logic tests, not
  browser end-to-end tests.
- Browser acceptance uses a hand check and screenshots. Chromium on this Mac
  was exercised; Safari, Firefox, mobile browsers and packaged Electron remain
  unverified. Native iOS/Android/HarmonyOS device behavior was not revalidated.

See the [dated validation record and screenshots](docs/validation.md), including
the native baseline failures.

## License

This fork preserves upstream Apache-2.0 and all third-party notices. New Web
port files use Apache-2.0. Yoga retains its MIT license. Packaging includes the
upstream NOTICE, Yoga license and Emscripten/runtime notices. No provider keys,
private application code or native SDK binaries are included.

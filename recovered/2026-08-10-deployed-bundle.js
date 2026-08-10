30ce0ad384ebef5152d1a2bf32a1783811d1cf2b7124896ad71b69d488b
Content-Disposition: form-data; name="index.js"

var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// node_modules/unenv/dist/runtime/_internal/utils.mjs
// @__NO_SIDE_EFFECTS__
function createNotImplementedError(name) {
  return new Error(`[unenv] ${name} is not implemented yet!`);
}
__name(createNotImplementedError, "createNotImplementedError");
// @__NO_SIDE_EFFECTS__
function notImplemented(name) {
  const fn = /* @__PURE__ */ __name(() => {
    throw /* @__PURE__ */ createNotImplementedError(name);
  }, "fn");
  return Object.assign(fn, { __unenv__: true });
}
__name(notImplemented, "notImplemented");
// @__NO_SIDE_EFFECTS__
function notImplementedClass(name) {
  return class {
    __unenv__ = true;
    constructor() {
      throw new Error(`[unenv] ${name} is not implemented yet!`);
    }
  };
}
__name(notImplementedClass, "notImplementedClass");

// node_modules/unenv/dist/runtime/node/internal/perf_hooks/performance.mjs
var _timeOrigin = globalThis.performance?.timeOrigin ?? Date.now();
var _performanceNow = globalThis.performance?.now ? globalThis.performance.now.bind(globalThis.performance) : () => Date.now() - _timeOrigin;
var nodeTiming = {
  name: "node",
  entryType: "node",
  startTime: 0,
  duration: 0,
  nodeStart: 0,
  v8Start: 0,
  bootstrapComplete: 0,
  environment: 0,
  loopStart: 0,
  loopExit: 0,
  idleTime: 0,
  uvMetricsInfo: {
    loopCount: 0,
    events: 0,
    eventsWaiting: 0
  },
  detail: void 0,
  toJSON() {
    return this;
  }
};
var PerformanceEntry = class {
  static {
    __name(this, "PerformanceEntry");
  }
  __unenv__ = true;
  detail;
  entryType = "event";
  name;
  startTime;
  constructor(name, options) {
    this.name = name;
    this.startTime = options?.startTime || _performanceNow();
    this.detail = options?.detail;
  }
  get duration() {
    return _performanceNow() - this.startTime;
  }
  toJSON() {
    return {
      name: this.name,
      entryType: this.entryType,
      startTime: this.startTime,
      duration: this.duration,
      detail: this.detail
    };
  }
};
var PerformanceMark = class PerformanceMark2 extends PerformanceEntry {
  static {
    __name(this, "PerformanceMark");
  }
  entryType = "mark";
  constructor() {
    super(...arguments);
  }
  get duration() {
    return 0;
  }
};
var PerformanceMeasure = class extends PerformanceEntry {
  static {
    __name(this, "PerformanceMeasure");
  }
  entryType = "measure";
};
var PerformanceResourceTiming = class extends PerformanceEntry {
  static {
    __name(this, "PerformanceResourceTiming");
  }
  entryType = "resource";
  serverTiming = [];
  connectEnd = 0;
  connectStart = 0;
  decodedBodySize = 0;
  domainLookupEnd = 0;
  domainLookupStart = 0;
  encodedBodySize = 0;
  fetchStart = 0;
  initiatorType = "";
  name = "";
  nextHopProtocol = "";
  redirectEnd = 0;
  redirectStart = 0;
  requestStart = 0;
  responseEnd = 0;
  responseStart = 0;
  secureConnectionStart = 0;
  startTime = 0;
  transferSize = 0;
  workerStart = 0;
  responseStatus = 0;
};
var PerformanceObserverEntryList = class {
  static {
    __name(this, "PerformanceObserverEntryList");
  }
  __unenv__ = true;
  getEntries() {
    return [];
  }
  getEntriesByName(_name, _type) {
    return [];
  }
  getEntriesByType(type) {
    return [];
  }
};
var Performance = class {
  static {
    __name(this, "Performance");
  }
  __unenv__ = true;
  timeOrigin = _timeOrigin;
  eventCounts = /* @__PURE__ */ new Map();
  _entries = [];
  _resourceTimingBufferSize = 0;
  navigation = void 0;
  timing = void 0;
  timerify(_fn, _options) {
    throw createNotImplementedError("Performance.timerify");
  }
  get nodeTiming() {
    return nodeTiming;
  }
  eventLoopUtilization() {
    return {};
  }
  markResourceTiming() {
    return new PerformanceResourceTiming("");
  }
  onresourcetimingbufferfull = null;
  now() {
    if (this.timeOrigin === _timeOrigin) {
      return _performanceNow();
    }
    return Date.now() - this.timeOrigin;
  }
  clearMarks(markName) {
    this._entries = markName ? this._entries.filter((e) => e.name !== markName) : this._entries.filter((e) => e.entryType !== "mark");
  }
  clearMeasures(measureName) {
    this._entries = measureName ? this._entries.filter((e) => e.name !== measureName) : this._entries.filter((e) => e.entryType !== "measure");
  }
  clearResourceTimings() {
    this._entries = this._entries.filter((e) => e.entryType !== "resource" || e.entryType !== "navigation");
  }
  getEntries() {
    return this._entries;
  }
  getEntriesByName(name, type) {
    return this._entries.filter((e) => e.name === name && (!type || e.entryType === type));
  }
  getEntriesByType(type) {
    return this._entries.filter((e) => e.entryType === type);
  }
  mark(name, options) {
    const entry = new PerformanceMark(name, options);
    this._entries.push(entry);
    return entry;
  }
  measure(measureName, startOrMeasureOptions, endMark) {
    let start;
    let end;
    if (typeof startOrMeasureOptions === "string") {
      start = this.getEntriesByName(startOrMeasureOptions, "mark")[0]?.startTime;
      end = this.getEntriesByName(endMark, "mark")[0]?.startTime;
    } else {
      start = Number.parseFloat(startOrMeasureOptions?.start) || this.now();
      end = Number.parseFloat(startOrMeasureOptions?.end) || this.now();
    }
    const entry = new PerformanceMeasure(measureName, {
      startTime: start,
      detail: {
        start,
        end
      }
    });
    this._entries.push(entry);
    return entry;
  }
  setResourceTimingBufferSize(maxSize) {
    this._resourceTimingBufferSize = maxSize;
  }
  addEventListener(type, listener, options) {
    throw createNotImplementedError("Performance.addEventListener");
  }
  removeEventListener(type, listener, options) {
    throw createNotImplementedError("Performance.removeEventListener");
  }
  dispatchEvent(event) {
    throw createNotImplementedError("Performance.dispatchEvent");
  }
  toJSON() {
    return this;
  }
};
var PerformanceObserver = class {
  static {
    __name(this, "PerformanceObserver");
  }
  __unenv__ = true;
  static supportedEntryTypes = [];
  _callback = null;
  constructor(callback) {
    this._callback = callback;
  }
  takeRecords() {
    return [];
  }
  disconnect() {
    throw createNotImplementedError("PerformanceObserver.disconnect");
  }
  observe(options) {
    throw createNotImplementedError("PerformanceObserver.observe");
  }
  bind(fn) {
    return fn;
  }
  runInAsyncScope(fn, thisArg, ...args) {
    return fn.call(thisArg, ...args);
  }
  asyncId() {
    return 0;
  }
  triggerAsyncId() {
    return 0;
  }
  emitDestroy() {
    return this;
  }
};
var performance = globalThis.performance && "addEventListener" in globalThis.performance ? globalThis.performance : new Performance();

// node_modules/@cloudflare/unenv-preset/dist/runtime/polyfill/performance.mjs
if (!("__unenv__" in performance)) {
  const proto = Performance.prototype;
  for (const key of Object.getOwnPropertyNames(proto)) {
    if (key !== "constructor" && !(key in performance)) {
      const desc = Object.getOwnPropertyDescriptor(proto, key);
      if (desc) {
        Object.defineProperty(performance, key, desc);
      }
    }
  }
}
globalThis.performance = performance;
globalThis.Performance = Performance;
globalThis.PerformanceEntry = PerformanceEntry;
globalThis.PerformanceMark = PerformanceMark;
globalThis.PerformanceMeasure = PerformanceMeasure;
globalThis.PerformanceObserver = PerformanceObserver;
globalThis.PerformanceObserverEntryList = PerformanceObserverEntryList;
globalThis.PerformanceResourceTiming = PerformanceResourceTiming;

// node_modules/unenv/dist/runtime/node/console.mjs
import { Writable } from "node:stream";

// node_modules/unenv/dist/runtime/mock/noop.mjs
var noop_default = Object.assign(() => {
}, { __unenv__: true });

// node_modules/unenv/dist/runtime/node/console.mjs
var _console = globalThis.console;
var _ignoreErrors = true;
var _stderr = new Writable();
var _stdout = new Writable();
var log = _console?.log ?? noop_default;
var info = _console?.info ?? log;
var trace = _console?.trace ?? info;
var debug = _console?.debug ?? log;
var table = _console?.table ?? log;
var error = _console?.error ?? log;
var warn = _console?.warn ?? error;
var createTask = _console?.createTask ?? /* @__PURE__ */ notImplemented("console.createTask");
var clear = _console?.clear ?? noop_default;
var count = _console?.count ?? noop_default;
var countReset = _console?.countReset ?? noop_default;
var dir = _console?.dir ?? noop_default;
var dirxml = _console?.dirxml ?? noop_default;
var group = _console?.group ?? noop_default;
var groupEnd = _console?.groupEnd ?? noop_default;
var groupCollapsed = _console?.groupCollapsed ?? noop_default;
var profile = _console?.profile ?? noop_default;
var profileEnd = _console?.profileEnd ?? noop_default;
var time = _console?.time ?? noop_default;
var timeEnd = _console?.timeEnd ?? noop_default;
var timeLog = _console?.timeLog ?? noop_default;
var timeStamp = _console?.timeStamp ?? noop_default;
var Console = _console?.Console ?? /* @__PURE__ */ notImplementedClass("console.Console");
var _times = /* @__PURE__ */ new Map();
var _stdoutErrorHandler = noop_default;
var _stderrErrorHandler = noop_default;

// node_modules/@cloudflare/unenv-preset/dist/runtime/node/console.mjs
var workerdConsole = globalThis["console"];
var {
  assert,
  clear: clear2,
  // @ts-expect-error undocumented public API
  context,
  count: count2,
  countReset: countReset2,
  // @ts-expect-error undocumented public API
  createTask: createTask2,
  debug: debug2,
  dir: dir2,
  dirxml: dirxml2,
  error: error2,
  group: group2,
  groupCollapsed: groupCollapsed2,
  groupEnd: groupEnd2,
  info: info2,
  log: log2,
  profile: profile2,
  profileEnd: profileEnd2,
  table: table2,
  time: time2,
  timeEnd: timeEnd2,
  timeLog: timeLog2,
  timeStamp: timeStamp2,
  trace: trace2,
  warn: warn2
} = workerdConsole;
Object.assign(workerdConsole, {
  Console,
  _ignoreErrors,
  _stderr,
  _stderrErrorHandler,
  _stdout,
  _stdoutErrorHandler,
  _times
});
var console_default = workerdConsole;

// node_modules/wrangler/_virtual_unenv_global_polyfill-@cloudflare-unenv-preset-node-console
globalThis.console = console_default;

// node_modules/unenv/dist/runtime/node/internal/process/hrtime.mjs
var hrtime = /* @__PURE__ */ Object.assign(/* @__PURE__ */ __name(function hrtime2(startTime) {
  const now = Date.now();
  const seconds = Math.trunc(now / 1e3);
  const nanos = now % 1e3 * 1e6;
  if (startTime) {
    let diffSeconds = seconds - startTime[0];
    let diffNanos = nanos - startTime[0];
    if (diffNanos < 0) {
      diffSeconds = diffSeconds - 1;
      diffNanos = 1e9 + diffNanos;
    }
    return [diffSeconds, diffNanos];
  }
  return [seconds, nanos];
}, "hrtime"), { bigint: /* @__PURE__ */ __name(function bigint() {
  return BigInt(Date.now() * 1e6);
}, "bigint") });

// node_modules/unenv/dist/runtime/node/internal/process/process.mjs
import { EventEmitter } from "node:events";

// node_modules/unenv/dist/runtime/node/internal/tty/read-stream.mjs
var ReadStream = class {
  static {
    __name(this, "ReadStream");
  }
  fd;
  isRaw = false;
  isTTY = false;
  constructor(fd) {
    this.fd = fd;
  }
  setRawMode(mode) {
    this.isRaw = mode;
    return this;
  }
};

// node_modules/unenv/dist/runtime/node/internal/tty/write-stream.mjs
var WriteStream = class {
  static {
    __name(this, "WriteStream");
  }
  fd;
  columns = 80;
  rows = 24;
  isTTY = false;
  constructor(fd) {
    this.fd = fd;
  }
  clearLine(dir3, callback) {
    callback && callback();
    return false;
  }
  clearScreenDown(callback) {
    callback && callback();
    return false;
  }
  cursorTo(x, y, callback) {
    callback && typeof callback === "function" && callback();
    return false;
  }
  moveCursor(dx, dy, callback) {
    callback && callback();
    return false;
  }
  getColorDepth(env2) {
    return 1;
  }
  hasColors(count3, env2) {
    return false;
  }
  getWindowSize() {
    return [this.columns, this.rows];
  }
  write(str, encoding, cb) {
    if (str instanceof Uint8Array) {
      str = new TextDecoder().decode(str);
    }
    try {
      console.log(str);
    } catch {
    }
    cb && typeof cb === "function" && cb();
    return false;
  }
};

// node_modules/unenv/dist/runtime/node/internal/process/node-version.mjs
var NODE_VERSION = "22.14.0";

// node_modules/unenv/dist/runtime/node/internal/process/process.mjs
var Process = class _Process extends EventEmitter {
  static {
    __name(this, "Process");
  }
  env;
  hrtime;
  nextTick;
  constructor(impl) {
    super();
    this.env = impl.env;
    this.hrtime = impl.hrtime;
    this.nextTick = impl.nextTick;
    for (const prop of [...Object.getOwnPropertyNames(_Process.prototype), ...Object.getOwnPropertyNames(EventEmitter.prototype)]) {
      const value = this[prop];
      if (typeof value === "function") {
        this[prop] = value.bind(this);
      }
    }
  }
  // --- event emitter ---
  emitWarning(warning, type, code) {
    console.warn(`${code ? `[${code}] ` : ""}${type ? `${type}: ` : ""}${warning}`);
  }
  emit(...args) {
    return super.emit(...args);
  }
  listeners(eventName) {
    return super.listeners(eventName);
  }
  // --- stdio (lazy initializers) ---
  #stdin;
  #stdout;
  #stderr;
  get stdin() {
    return this.#stdin ??= new ReadStream(0);
  }
  get stdout() {
    return this.#stdout ??= new WriteStream(1);
  }
  get stderr() {
    return this.#stderr ??= new WriteStream(2);
  }
  // --- cwd ---
  #cwd = "/";
  chdir(cwd2) {
    this.#cwd = cwd2;
  }
  cwd() {
    return this.#cwd;
  }
  // --- dummy props and getters ---
  arch = "";
  platform = "";
  argv = [];
  argv0 = "";
  execArgv = [];
  execPath = "";
  title = "";
  pid = 200;
  ppid = 100;
  get version() {
    return `v${NODE_VERSION}`;
  }
  get versions() {
    return { node: NODE_VERSION };
  }
  get allowedNodeEnvironmentFlags() {
    return /* @__PURE__ */ new Set();
  }
  get sourceMapsEnabled() {
    return false;
  }
  get debugPort() {
    return 0;
  }
  get throwDeprecation() {
    return false;
  }
  get traceDeprecation() {
    return false;
  }
  get features() {
    return {};
  }
  get release() {
    return {};
  }
  get connected() {
    return false;
  }
  get config() {
    return {};
  }
  get moduleLoadList() {
    return [];
  }
  constrainedMemory() {
    return 0;
  }
  availableMemory() {
    return 0;
  }
  uptime() {
    return 0;
  }
  resourceUsage() {
    return {};
  }
  // --- noop methods ---
  ref() {
  }
  unref() {
  }
  // --- unimplemented methods ---
  umask() {
    throw createNotImplementedError("process.umask");
  }
  getBuiltinModule() {
    return void 0;
  }
  getActiveResourcesInfo() {
    throw createNotImplementedError("process.getActiveResourcesInfo");
  }
  exit() {
    throw createNotImplementedError("process.exit");
  }
  reallyExit() {
    throw createNotImplementedError("process.reallyExit");
  }
  kill() {
    throw createNotImplementedError("process.kill");
  }
  abort() {
    throw createNotImplementedError("process.abort");
  }
  dlopen() {
    throw createNotImplementedError("process.dlopen");
  }
  setSourceMapsEnabled() {
    throw createNotImplementedError("process.setSourceMapsEnabled");
  }
  loadEnvFile() {
    throw createNotImplementedError("process.loadEnvFile");
  }
  disconnect() {
    throw createNotImplementedError("process.disconnect");
  }
  cpuUsage() {
    throw createNotImplementedError("process.cpuUsage");
  }
  setUncaughtExceptionCaptureCallback() {
    throw createNotImplementedError("process.setUncaughtExceptionCaptureCallback");
  }
  hasUncaughtExceptionCaptureCallback() {
    throw createNotImplementedError("process.hasUncaughtExceptionCaptureCallback");
  }
  initgroups() {
    throw createNotImplementedError("process.initgroups");
  }
  openStdin() {
    throw createNotImplementedError("process.openStdin");
  }
  assert() {
    throw createNotImplementedError("process.assert");
  }
  binding() {
    throw createNotImplementedError("process.binding");
  }
  // --- attached interfaces ---
  permission = { has: /* @__PURE__ */ notImplemented("process.permission.has") };
  report = {
    directory: "",
    filename: "",
    signal: "SIGUSR2",
    compact: false,
    reportOnFatalError: false,
    reportOnSignal: false,
    reportOnUncaughtException: false,
    getReport: /* @__PURE__ */ notImplemented("process.report.getReport"),
    writeReport: /* @__PURE__ */ notImplemented("process.report.writeReport")
  };
  finalization = {
    register: /* @__PURE__ */ notImplemented("process.finalization.register"),
    unregister: /* @__PURE__ */ notImplemented("process.finalization.unregister"),
    registerBeforeExit: /* @__PURE__ */ notImplemented("process.finalization.registerBeforeExit")
  };
  memoryUsage = Object.assign(() => ({
    arrayBuffers: 0,
    rss: 0,
    external: 0,
    heapTotal: 0,
    heapUsed: 0
  }), { rss: /* @__PURE__ */ __name(() => 0, "rss") });
  // --- undefined props ---
  mainModule = void 0;
  domain = void 0;
  // optional
  send = void 0;
  exitCode = void 0;
  channel = void 0;
  getegid = void 0;
  geteuid = void 0;
  getgid = void 0;
  getgroups = void 0;
  getuid = void 0;
  setegid = void 0;
  seteuid = void 0;
  setgid = void 0;
  setgroups = void 0;
  setuid = void 0;
  // internals
  _events = void 0;
  _eventsCount = void 0;
  _exiting = void 0;
  _maxListeners = void 0;
  _debugEnd = void 0;
  _debugProcess = void 0;
  _fatalException = void 0;
  _getActiveHandles = void 0;
  _getActiveRequests = void 0;
  _kill = void 0;
  _preload_modules = void 0;
  _rawDebug = void 0;
  _startProfilerIdleNotifier = void 0;
  _stopProfilerIdleNotifier = void 0;
  _tickCallback = void 0;
  _disconnect = void 0;
  _handleQueue = void 0;
  _pendingMessage = void 0;
  _channel = void 0;
  _send = void 0;
  _linkedBinding = void 0;
};

// node_modules/@cloudflare/unenv-preset/dist/runtime/node/process.mjs
var globalProcess = globalThis["process"];
var getBuiltinModule = globalProcess.getBuiltinModule;
var workerdProcess = getBuiltinModule("node:process");
var unenvProcess = new Process({
  env: globalProcess.env,
  hrtime,
  // `nextTick` is available from workerd process v1
  nextTick: workerdProcess.nextTick
});
var { exit, features, platform } = workerdProcess;
var {
  _channel,
  _debugEnd,
  _debugProcess,
  _disconnect,
  _events,
  _eventsCount,
  _exiting,
  _fatalException,
  _getActiveHandles,
  _getActiveRequests,
  _handleQueue,
  _kill,
  _linkedBinding,
  _maxListeners,
  _pendingMessage,
  _preload_modules,
  _rawDebug,
  _send,
  _startProfilerIdleNotifier,
  _stopProfilerIdleNotifier,
  _tickCallback,
  abort,
  addListener,
  allowedNodeEnvironmentFlags,
  arch,
  argv,
  argv0,
  assert: assert2,
  availableMemory,
  binding,
  channel,
  chdir,
  config,
  connected,
  constrainedMemory,
  cpuUsage,
  cwd,
  debugPort,
  disconnect,
  dlopen,
  domain,
  emit,
  emitWarning,
  env,
  eventNames,
  execArgv,
  execPath,
  exitCode,
  finalization,
  getActiveResourcesInfo,
  getegid,
  geteuid,
  getgid,
  getgroups,
  getMaxListeners,
  getuid,
  hasUncaughtExceptionCaptureCallback,
  hrtime: hrtime3,
  initgroups,
  kill,
  listenerCount,
  listeners,
  loadEnvFile,
  mainModule,
  memoryUsage,
  moduleLoadList,
  nextTick,
  off,
  on,
  once,
  openStdin,
  permission,
  pid,
  ppid,
  prependListener,
  prependOnceListener,
  rawListeners,
  reallyExit,
  ref,
  release,
  removeAllListeners,
  removeListener,
  report,
  resourceUsage,
  send,
  setegid,
  seteuid,
  setgid,
  setgroups,
  setMaxListeners,
  setSourceMapsEnabled,
  setuid,
  setUncaughtExceptionCaptureCallback,
  sourceMapsEnabled,
  stderr,
  stdin,
  stdout,
  throwDeprecation,
  title,
  traceDeprecation,
  umask,
  unref,
  uptime,
  version,
  versions
} = unenvProcess;
var _process = {
  abort,
  addListener,
  allowedNodeEnvironmentFlags,
  hasUncaughtExceptionCaptureCallback,
  setUncaughtExceptionCaptureCallback,
  loadEnvFile,
  sourceMapsEnabled,
  arch,
  argv,
  argv0,
  chdir,
  config,
  connected,
  constrainedMemory,
  availableMemory,
  cpuUsage,
  cwd,
  debugPort,
  dlopen,
  disconnect,
  emit,
  emitWarning,
  env,
  eventNames,
  execArgv,
  execPath,
  exit,
  finalization,
  features,
  getBuiltinModule,
  getActiveResourcesInfo,
  getMaxListeners,
  hrtime: hrtime3,
  kill,
  listeners,
  listenerCount,
  memoryUsage,
  nextTick,
  on,
  off,
  once,
  pid,
  platform,
  ppid,
  prependListener,
  prependOnceListener,
  rawListeners,
  release,
  removeAllListeners,
  removeListener,
  report,
  resourceUsage,
  setMaxListeners,
  setSourceMapsEnabled,
  stderr,
  stdin,
  stdout,
  title,
  throwDeprecation,
  traceDeprecation,
  umask,
  uptime,
  version,
  versions,
  // @ts-expect-error old API
  domain,
  initgroups,
  moduleLoadList,
  reallyExit,
  openStdin,
  assert: assert2,
  binding,
  send,
  exitCode,
  channel,
  getegid,
  geteuid,
  getgid,
  getgroups,
  getuid,
  setegid,
  seteuid,
  setgid,
  setgroups,
  setuid,
  permission,
  mainModule,
  _events,
  _eventsCount,
  _exiting,
  _maxListeners,
  _debugEnd,
  _debugProcess,
  _fatalException,
  _getActiveHandles,
  _getActiveRequests,
  _kill,
  _preload_modules,
  _rawDebug,
  _startProfilerIdleNotifier,
  _stopProfilerIdleNotifier,
  _tickCallback,
  _disconnect,
  _handleQueue,
  _pendingMessage,
  _channel,
  _send,
  _linkedBinding
};
var process_default = _process;

// node_modules/wrangler/_virtual_unenv_global_polyfill-@cloudflare-unenv-preset-node-process
globalThis.process = process_default;

// src/index.ts
import { DurableObject } from "cloudflare:workers";
var PUBLIC_PATHS = /* @__PURE__ */ new Set(["/", "/daemon"]);
var VALID_CATEGORIES = /* @__PURE__ */ new Set([
  "work",
  "decision",
  "insight",
  "meaningful",
  "thread_open",
  "thread_closed",
  "artifact",
  "fire",
  "cross_ai",
  "anomaly",
  "somatic"
]);
var Brook = class extends DurableObject {
  static {
    __name(this, "Brook");
  }
  async init() {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS alerts (
        id TEXT PRIMARY KEY,
        ts TEXT NOT NULL,
        type TEXT NOT NULL,
        severity TEXT NOT NULL,
        message TEXT NOT NULL,
        read INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS repos (
        name TEXT PRIMARY KEY,
        last_commit_sha TEXT,
        last_checked TEXT,
        is_private INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS checks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        trigger TEXT NOT NULL,
        repos_checked INTEGER DEFAULT 0,
        alerts_generated INTEGER DEFAULT 0,
        duration_ms INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT
      );
      CREATE TABLE IF NOT EXISTS agents (
        name TEXT PRIMARY KEY,
        status TEXT DEFAULT 'offline',
        last_checkin TEXT,
        last_checkout TEXT,
        working_on TEXT,
        machine TEXT,
        context TEXT DEFAULT '',
        capabilities TEXT DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS agent_registry (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent TEXT NOT NULL,
        ts TEXT NOT NULL,
        what TEXT NOT NULL,
        location TEXT DEFAULT '',
        status TEXT DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS context_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL DEFAULT '',
        agent TEXT NOT NULL,
        ts TEXT NOT NULL,
        category TEXT NOT NULL,
        weight INTEGER DEFAULT 5,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        tags TEXT DEFAULT '',
        thread TEXT DEFAULT '',
        expires TEXT DEFAULT ''
      );
    `);
    try {
      this.ctx.storage.sql.exec(`ALTER TABLE agents ADD COLUMN context TEXT DEFAULT ''`);
    } catch {
    }
    try {
      this.ctx.storage.sql.exec(`ALTER TABLE agents ADD COLUMN capabilities TEXT DEFAULT ''`);
    } catch {
    }
    try {
      this.ctx.storage.sql.exec(`CREATE INDEX IF NOT EXISTS idx_context_ts ON context_log(ts DESC)`);
    } catch {
    }
    try {
      this.ctx.storage.sql.exec(`CREATE INDEX IF NOT EXISTS idx_context_category ON context_log(category)`);
    } catch {
    }
    try {
      this.ctx.storage.sql.exec(`CREATE INDEX IF NOT EXISTS idx_context_thread ON context_log(thread)`);
    } catch {
    }
    try {
      this.ctx.storage.sql.exec(`CREATE INDEX IF NOT EXISTS idx_context_weight ON context_log(weight DESC)`);
    } catch {
    }
    try {
      this.ctx.storage.sql.exec(`CREATE INDEX IF NOT EXISTS idx_context_agent ON context_log(agent)`);
    } catch {
    }
  }
  // ═══════════════════════════════════════════════════════════════
  // NEVERSINK CONTEXT LAYER
  // ═══════════════════════════════════════════════════════════════
  // ─── POST /context — Write context events ─────────────────────
  async handleContextWrite(request) {
    const body = await request.json();
    const agent = body.agent;
    const sessionId = body.session_id || "";
    const events = body.events;
    if (!agent) {
      return Response.json({ error: "agent required" }, { status: 400 });
    }
    const eventList = events ? events : [body];
    let written = 0;
    for (const evt of eventList) {
      const category = evt.category;
      const weight = Math.min(10, Math.max(1, parseInt(evt.weight) || 5));
      const title2 = evt.title;
      const eventBody = evt.body;
      if (!category || !title2 || !eventBody) continue;
      if (!VALID_CATEGORIES.has(category)) continue;
      this.ctx.storage.sql.exec(
        `INSERT INTO context_log (session_id, agent, ts, category, weight, title, body, tags, thread, expires)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        sessionId,
        agent,
        (/* @__PURE__ */ new Date()).toISOString(),
        category,
        weight,
        title2,
        eventBody,
        evt.tags || "",
        evt.thread || "",
        evt.expires || ""
      );
      written++;
    }
    return Response.json({ ok: true, agent, written });
  }
  // ─── GET /briefing — Session startup briefing ─────────────────
  handleBriefing(url) {
    const agent = url.searchParams.get("agent") || "all";
    const full = url.searchParams.get("full") === "true";
    const thread = url.searchParams.get("thread") || "";
    const since = url.searchParams.get("since") || "";
    const now = /* @__PURE__ */ new Date();
    let sinceTs = since;
    if (!sinceTs && agent !== "all") {
      const agentRow = this.ctx.storage.sql.exec(
        "SELECT last_checkout FROM agents WHERE name = ?",
        agent
      ).toArray();
      if (agentRow.length > 0 && agentRow[0].last_checkout) {
        sinceTs = agentRow[0].last_checkout;
      }
    }
    if (!sinceTs) {
      sinceTs = new Date(now.getTime() - 48 * 60 * 60 * 1e3).toISOString();
    }
    let sinceDuration = "";
    if (sinceTs) {
      const diffMs = now.getTime() - new Date(sinceTs).getTime();
      const hours = Math.floor(diffMs / (1e3 * 60 * 60));
      const mins = Math.floor(diffMs % (1e3 * 60 * 60) / (1e3 * 60));
      sinceDuration = `${hours}h ${mins}m`;
    }
    const fires = this.ctx.storage.sql.exec(
      `SELECT * FROM context_log
       WHERE category = 'fire'
       AND (expires = '' OR expires > ?)
       AND weight >= 7
       ORDER BY weight DESC, ts DESC
       LIMIT 10`,
      now.toISOString()
    ).toArray();
    const sentinelAlerts = this.ctx.storage.sql.exec(
      "SELECT * FROM alerts WHERE read = 0 ORDER BY ts DESC LIMIT 10"
    ).toArray();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1e3).toISOString();
    const highWeight = this.ctx.storage.sql.exec(
      `SELECT * FROM context_log
       WHERE weight >= 7 AND ts > ?
       ORDER BY weight DESC, ts DESC
       LIMIT 20`,
      sevenDaysAgo
    ).toArray();
    const openThreads = this.ctx.storage.sql.exec(
      `SELECT * FROM context_log
       WHERE category = 'thread_open'
       AND title NOT IN (
         SELECT title FROM context_log WHERE category = 'thread_closed'
       )
       ORDER BY weight DESC, ts DESC
       LIMIT 20`
    ).toArray();
    let recentContext;
    if (thread) {
      recentContext = this.ctx.storage.sql.exec(
        `SELECT * FROM context_log
         WHERE thread = ? AND ts > ?
         ORDER BY ts DESC
         LIMIT 50`,
        thread,
        sinceTs
      ).toArray();
    } else if (full) {
      recentContext = this.ctx.storage.sql.exec(
        `SELECT * FROM context_log
         WHERE ts > ?
         ORDER BY ts DESC
         LIMIT 100`,
        sinceTs
      ).toArray();
    } else {
      recentContext = this.ctx.storage.sql.exec(
        `SELECT id, session_id, agent, ts, category, weight, title,
         CASE WHEN weight >= 7 THEN body ELSE '' END as body,
         tags, thread
         FROM context_log
         WHERE ts > ?
         ORDER BY ts DESC
         LIMIT 50`,
        sinceTs
      ).toArray();
    }
    const fleetStatus = this.ctx.storage.sql.exec(
      "SELECT name, status, last_checkin, last_checkout, working_on, machine FROM agents ORDER BY last_checkin DESC"
    ).toArray().map((a) => {
      const lc = a.last_checkin ? new Date(a.last_checkin).getTime() : 0;
      const hrs = Math.round((now.getTime() - lc) / (1e3 * 60 * 60) * 10) / 10;
      let ds = a.status;
      if (ds === "online" && hrs > 2) ds = "stale";
      return { ...a, displayStatus: ds, hoursSinceCheckin: hrs };
    });
    return Response.json({
      neversink: "1.0.0",
      briefing_for: agent,
      since_last_session: sinceDuration,
      generated: now.toISOString(),
      fires,
      sentinel_alerts: sentinelAlerts,
      high_weight: highWeight,
      open_threads: openThreads,
      recent_context: recentContext,
      fleet: fleetStatus
    });
  }
  // ─── GET /context/search — Query context by thread, tag, date ──
  handleContextSearch(url) {
    const thread = url.searchParams.get("thread") || "";
    const tag = url.searchParams.get("tag") || "";
    const category = url.searchParams.get("category") || "";
    const agent = url.searchParams.get("agent") || "";
    const since = url.searchParams.get("since") || "";
    const minWeight = parseInt(url.searchParams.get("min_weight") || "1");
    const limit = Math.min(100, parseInt(url.searchParams.get("limit") || "50"));
    let query = "SELECT * FROM context_log WHERE 1=1";
    const params = [];
    if (thread) {
      query += " AND thread = ?";
      params.push(thread);
    }
    if (tag) {
      query += " AND tags LIKE ?";
      params.push(`%${tag}%`);
    }
    if (category) {
      query += " AND category = ?";
      params.push(category);
    }
    if (agent) {
      query += " AND agent = ?";
      params.push(agent);
    }
    if (since) {
      query += " AND ts > ?";
      params.push(since);
    }
    if (minWeight > 1) {
      query += " AND weight >= ?";
      params.push(minWeight);
    }
    query += " ORDER BY ts DESC LIMIT ?";
    params.push(limit);
    const rows = this.ctx.storage.sql.exec(query, ...params).toArray();
    return Response.json({ results: rows, count: rows.length });
  }
  // ─── Context decay — clean up expired low-weight events ────────
  runContextDecay() {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    this.ctx.storage.sql.exec(
      "DELETE FROM context_log WHERE category = 'fire' AND expires != '' AND expires < ?",
      now
    );
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1e3).toISOString();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1e3).toISOString();
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1e3).toISOString();
    this.ctx.storage.sql.exec(
      "DELETE FROM context_log WHERE weight <= 3 AND ts < ?",
      sevenDaysAgo
    );
    this.ctx.storage.sql.exec(
      "DELETE FROM context_log WHERE weight BETWEEN 4 AND 6 AND ts < ?",
      thirtyDaysAgo
    );
    this.ctx.storage.sql.exec(
      "DELETE FROM context_log WHERE weight BETWEEN 7 AND 8 AND ts < ?",
      ninetyDaysAgo
    );
  }
  // ═══════════════════════════════════════════════════════════════
  // ORIGINAL BROOK FUNCTIONALITY (preserved)
  // ═══════════════════════════════════════════════════════════════
  // ─── Core check loop ──────────────────────────────────────────
  async runCheck(trigger) {
    await this.init();
    const start = Date.now();
    const newAlerts = [];
    const org = this.env.GITHUB_ORG;
    const token = this.env.GITHUB_TOKEN;
    this.runContextDecay();
    const headers = {
      "Accept": "application/vnd.github+json",
      "User-Agent": "neversink/1.0"
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    let repos = [];
    let repoFetchOk = false;
    let lastStatus = 0;
    try {
      let res = await fetch(`https://api.github.com/orgs/${org}/repos?per_page=100&sort=updated`, { headers });
      lastStatus = res.status;
      if (res.ok) {
        repos = await res.json();
        repoFetchOk = true;
      } else {
        res = await fetch(`https://api.github.com/user/repos?per_page=100&sort=updated&type=all`, { headers });
        lastStatus = res.status;
        if (res.ok) {
          const allRepos = await res.json();
          repos = allRepos.filter((r) => r.full_name?.startsWith(`${org}/`));
          repoFetchOk = true;
        }
      }
    } catch (e) {
      newAlerts.push(this.makeAlert("git", "warn", `GitHub API call failed: ${e}`));
    }
    if (!repoFetchOk) {
      newAlerts.push(this.makeAlert(
        "git",
        "critical",
        `GitHub repo fetch FAILED (HTTP ${lastStatus}) for org "${org}". Brook is BLIND, not quiet \u2014 every downstream check this cycle is meaningless. Check GITHUB_TOKEN.`
      ));
    }
    const knownRepos = /* @__PURE__ */ new Set();
    const cursor = this.ctx.storage.sql.exec("SELECT name FROM repos");
    for (const row of cursor) {
      knownRepos.add(row.name);
    }
    const newRepos = repos.filter((r) => !knownRepos.has(r.name));
    if (newRepos.length > parseInt(this.env.ALERT_THRESHOLD_REPOS || "2")) {
      newAlerts.push(this.makeAlert(
        "new_repo",
        "critical",
        `${newRepos.length} new repos created: ${newRepos.map((r) => r.name).join(", ")}`
      ));
    } else if (newRepos.length > 0) {
      newAlerts.push(this.makeAlert(
        "new_repo",
        "info",
        `New repo(s): ${newRepos.map((r) => r.name).join(", ")}`
      ));
    }
    let totalNewCommits = 0;
    const lastCheck = this.getMeta("last_check_ts") || new Date(Date.now() - 36e5).toISOString();
    for (const repo of repos) {
      try {
        const commitsRes = await fetch(
          `https://api.github.com/repos/${org}/${repo.name}/commits?since=${lastCheck}&per_page=50`,
          { headers }
        );
        if (!commitsRes.ok) continue;
        const commits = await commitsRes.json();
        if (commits.length > 0) {
          totalNewCommits += commits.length;
          for (const commit of commits.slice(0, 5)) {
            try {
              const detailRes = await fetch(
                `https://api.github.com/repos/${org}/${repo.name}/commits/${commit.sha}`,
                { headers }
              );
              if (detailRes.ok) {
                const detail = await detailRes.json();
                if (detail.stats && detail.stats.total > parseInt(this.env.ALERT_THRESHOLD_FILES || "100")) {
                  newAlerts.push(this.makeAlert(
                    "volume",
                    "warn",
                    `Large commit in ${repo.name}: ${detail.stats.total} changes \u2014 "${commit.commit.message.split("\n")[0]}"`
                  ));
                }
              }
            } catch {
            }
          }
          this.ctx.storage.sql.exec(
            `INSERT OR REPLACE INTO repos (name, last_commit_sha, last_checked, is_private)
             VALUES (?, ?, ?, ?)`,
            repo.name,
            commits[0].sha,
            (/* @__PURE__ */ new Date()).toISOString(),
            repo.private ? 1 : 0
          );
        } else {
          this.ctx.storage.sql.exec(
            `INSERT OR REPLACE INTO repos (name, last_commit_sha, last_checked, is_private)
             VALUES (?, COALESCE((SELECT last_commit_sha FROM repos WHERE name = ?), ''), ?, ?)`,
            repo.name,
            repo.name,
            (/* @__PURE__ */ new Date()).toISOString(),
            repo.private ? 1 : 0
          );
        }
      } catch {
      }
    }
    if (totalNewCommits > parseInt(this.env.ALERT_THRESHOLD_COMMITS || "20")) {
      newAlerts.push(this.makeAlert(
        "volume",
        "critical",
        `High volume: ${totalNewCommits} commits across org since last check`
      ));
    }
    try {
      const bridgeRes = await fetch(
        `https://api.github.com/repos/${org}/${this.env.FLEET_BRIDGE_REPO}/commits?per_page=5`,
        { headers }
      );
      if (bridgeRes.ok) {
        const bridgeCommits = await bridgeRes.json();
        if (bridgeCommits.length > 0) {
          const lastBridgeUpdate = new Date(bridgeCommits[0].commit.author.date);
          const hoursSinceUpdate = (Date.now() - lastBridgeUpdate.getTime()) / (1e3 * 60 * 60);
          if (hoursSinceUpdate > 24) {
            newAlerts.push(this.makeAlert(
              "drift",
              "warn",
              `Fleet-bridge has not been updated in ${Math.round(hoursSinceUpdate)} hours. Agents may be going dark.`
            ));
          }
        }
      }
    } catch (e) {
      newAlerts.push(this.makeAlert("drift", "info", `Could not check fleet-bridge: ${e}`));
    }
    try {
      const regRes = await fetch(
        `https://raw.githubusercontent.com/${org}/${this.env.FLEET_BRIDGE_REPO}/main/registry/2026-03-24.md`,
        { headers }
      );
      if (regRes.ok) {
        const regText = await regRes.text();
        const lines = regText.split("\n").filter((l) => l.startsWith("|") && !l.includes("---") && !l.includes("Time"));
        const topicAgentMap = /* @__PURE__ */ new Map();
        for (const line of lines) {
          const cols = line.split("|").map((c) => c.trim()).filter((c) => c);
          if (cols.length >= 3) {
            const agent = cols[1]?.toLowerCase();
            const what = cols[2]?.toLowerCase();
            if (agent && what) {
              const keywords = what.split(/\s+/).filter((w) => w.length > 4);
              for (const kw of keywords) {
                if (!topicAgentMap.has(kw)) topicAgentMap.set(kw, /* @__PURE__ */ new Set());
                topicAgentMap.get(kw).add(agent);
              }
            }
          }
        }
        for (const [topic, agents] of topicAgentMap) {
          if (agents.size > 1 && !["approved", "moser", "archie", "ceecee", "fleet", "bridge"].includes(topic)) {
            this.setMeta(`frag_${topic}`, Array.from(agents).join(","));
          }
        }
      }
    } catch {
    }
    const duration = Date.now() - start;
    await this.pollFleetEndpoints(newAlerts);
    for (const alert of newAlerts) {
      const dupe = [...this.ctx.storage.sql.exec(
        "SELECT id FROM alerts WHERE read = 0 AND type = ? AND message = ? LIMIT 1",
        alert.type,
        alert.message
      )];
      if (dupe.length > 0) {
        this.ctx.storage.sql.exec("UPDATE alerts SET ts = ? WHERE id = ?", alert.ts, dupe[0].id);
        continue;
      }
      this.ctx.storage.sql.exec(
        `INSERT OR IGNORE INTO alerts (id, ts, type, severity, message, read) VALUES (?, ?, ?, ?, ?, 0)`,
        alert.id,
        alert.ts,
        alert.type,
        alert.severity,
        alert.message
      );
    }
    this.ctx.storage.sql.exec(
      `INSERT INTO checks (ts, trigger, repos_checked, alerts_generated, duration_ms)
       VALUES (?, ?, ?, ?, ?)`,
      (/* @__PURE__ */ new Date()).toISOString(),
      trigger,
      repos.length,
      newAlerts.length,
      duration
    );
    this.setMeta("last_check_ts", (/* @__PURE__ */ new Date()).toISOString());
    this.setMeta("total_checks", String(parseInt(this.getMeta("total_checks") || "0") + 1));
    if (newAlerts.length > 0) {
      const critical = newAlerts.filter((a) => a.severity === "critical");
      const warns = newAlerts.filter((a) => a.severity === "warn");
      const lines = [];
      if (critical.length > 0) {
        lines.push(`CRITICAL (${critical.length}):`);
        for (const a of critical.slice(0, 3)) lines.push(`  ${a.message.slice(0, 120)}`);
      }
      if (warns.length > 0) {
        lines.push(`WARN (${warns.length}):`);
        for (const a of warns.slice(0, 3)) lines.push(`  ${a.message.slice(0, 120)}`);
        if (warns.length > 3) lines.push(`  ...and ${warns.length - 3} more`);
      }
      const priority = critical.length > 0 ? 5 : 4;
      const tags = critical.length > 0 ? "rotating_light" : "warning";
      await this.sendPush(
        `Neversink: ${newAlerts.length} alerts`,
        lines.join("\n"),
        priority,
        tags
      );
    }
    await this.pushActiveFires();
    const summary = [
      `Neversink check complete (${trigger}, ${duration}ms)`,
      `Repos: ${repos.length} checked, ${newRepos.length} new`,
      `Commits: ${totalNewCommits} since last check`,
      `Alerts: ${newAlerts.length} generated`
    ].join("\n");
    return { alerts: newAlerts, summary };
  }
  // ─── HTTP handler ─────────────────────────────────────────────
  async fetch(request) {
    await this.init();
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === "/daemon") {
      return this.handleDaemon();
    }
    if (path.startsWith("/daemon/")) {
      const agentName = path.split("/")[2];
      if (agentName) return this.handleAgentDaemon(agentName);
    }
    if (!PUBLIC_PATHS.has(path)) {
      const authHeader = request.headers.get("Authorization") || "";
      const token = authHeader.replace("Bearer ", "");
      if (!this.env.BROOK_API_KEY || token !== this.env.BROOK_API_KEY) {
        return Response.json(
          { error: "Unauthorized. Bearer token required for private endpoints." },
          { status: 401 }
        );
      }
    }
    if (path === "/context" && request.method === "POST") {
      return this.handleContextWrite(request);
    }
    if (path === "/briefing") {
      return this.handleBriefing(url);
    }
    if (path === "/context/search") {
      return this.handleContextSearch(url);
    }
    if (path === "/status") {
      return this.handleStatus();
    }
    if (path === "/check") {
      const result = await this.runCheck("manual");
      return Response.json(result);
    }
    if (path === "/alerts") {
      return this.handleAlerts(url);
    }
    if (path === "/silence") {
      const id = url.searchParams.get("id");
      if (id) {
        this.ctx.storage.sql.exec("UPDATE alerts SET read = 1 WHERE id = ?", id);
        return Response.json({ ok: true });
      }
      const before = url.searchParams.get("before");
      if (before) {
        const n = [...this.ctx.storage.sql.exec("SELECT COUNT(*) AS c FROM alerts WHERE read = 0 AND ts < ?", before)];
        this.ctx.storage.sql.exec("UPDATE alerts SET read = 1 WHERE read = 0 AND ts < ?", before);
        return Response.json({ ok: true, silenced: n[0]?.c ?? 0, before });
      }
      return Response.json({ error: "id or before required" }, { status: 400 });
    }
    if (path === "/webhook") {
      const result = await this.runCheck("webhook");
      return Response.json(result);
    }
    if (path === "/checkin" && request.method === "POST") {
      return this.handleCheckin(request);
    }
    if (path === "/checkout" && request.method === "POST") {
      return this.handleCheckout(request);
    }
    if (path === "/agent/remove" && request.method === "POST") {
      const body = await request.json();
      if (!body.name) return Response.json({ error: "name required" }, { status: 400 });
      this.ctx.storage.sql.exec("DELETE FROM agents WHERE name = ?", body.name);
      return Response.json({ ok: true, removed: body.name });
    }
    if (path === "/fleet") {
      return this.handleFleet();
    }
    if (path === "/publish" && request.method === "POST") {
      return this.handlePublish(request);
    }
    if (path.startsWith("/agent/")) {
      const agentName = path.split("/")[2];
      if (agentName) return this.handleAgentQuery(agentName);
    }
    if (path === "/history") {
      const rows = this.ctx.storage.sql.exec(
        "SELECT * FROM checks ORDER BY ts DESC LIMIT 24"
      ).toArray();
      return Response.json(rows);
    }
    return Response.json({
      name: "Neversink \u2014 Persistent Awareness Layer",
      version: "1.0.0",
      evolved_from: "Brook (Fleet Overwatch)",
      public: ["/daemon"],
      context: ["/context (POST)", "/briefing (GET)", "/context/search (GET)"],
      fleet: ["/checkin (POST)", "/checkout (POST)", "/fleet", "/agent/:name", "/publish (POST)"],
      monitoring: ["/status", "/check", "/alerts", "/silence?id=X", "/webhook", "/history"],
      auth: "Bearer token required for private endpoints"
    });
  }
  // ─── Cron handler ─────────────────────────────────────────────
  async alarm() {
    await this.runCheck("cron");
  }
  // ─── Fleet agent tracking ──────────────────────────────────────
  /**
   * Active liveness: probe each publicly-reachable fleet worker's /health.
   * Presence is recorded with presence_source='polled' so an observation Brook
   * made itself is never confused with an agent's self-report.
   */
  async pollFleetEndpoints(newAlerts) {
    try {
      this.ctx.storage.sql.exec("ALTER TABLE agents ADD COLUMN presence_source TEXT DEFAULT 'checkin'");
    } catch {
    }
    const targets = [
      { name: "appsec-gate", url: "https://appsec-gate.robert-chuvala.workers.dev/health", machine: "cloudflare-worker", note: "PR-diff security review, fails closed" },
      { name: "finops-do", url: "https://finops-do.robert-chuvala.workers.dev/health", machine: "cloudflare-worker", note: "daily AI Gateway spend ceiling + reconciliation" },
      { name: "daemon", url: "https://daemon.robert-chuvala.workers.dev/health", machine: "cloudflare-worker", note: "Big Head Todd \u2014 canonical context store" },
      { name: "mycelia-api", url: "https://mycelia-api.robert-chuvala.workers.dev/health", machine: "cloudflare-worker", note: "fleet mutual-aid protocol" },
      { name: "bivouac", url: "https://bivouac.robert-chuvala.workers.dev/health", machine: "cloudflare-worker", note: "overnight autonomous coding agent" },
      { name: "sa-dashboard-kit", url: "https://sa-dashboard-kit.robert-chuvala.workers.dev/health", machine: "cloudflare-worker", note: "public SA observability kit" }
    ];
    const now = (/* @__PURE__ */ new Date()).toISOString();
    for (const t of targets) {
      let ok = false;
      let detail = "";
      try {
        const res = await fetch(t.url, { method: "GET" });
        ok = res.ok;
        detail = `HTTP ${res.status}`;
      } catch (e) {
        detail = `unreachable: ${e}`;
      }
      if (ok) {
        this.ctx.storage.sql.exec(
          `INSERT INTO agents (name, status, last_checkin, working_on, machine, context, capabilities, presence_source)
           VALUES (?, 'online', ?, ?, ?, '', '', 'polled')
           ON CONFLICT(name) DO UPDATE SET
             status = 'online',
             last_checkin = excluded.last_checkin,
             machine = excluded.machine,
             presence_source = 'polled'`,
          t.name,
          now,
          t.note,
          t.machine
        );
      } else {
        const known = [...this.ctx.storage.sql.exec("SELECT name FROM agents WHERE name = ?", t.name)];
        if (known.length > 0) {
          this.ctx.storage.sql.exec("UPDATE agents SET status = 'offline' WHERE name = ?", t.name);
          newAlerts.push(this.makeAlert(
            "fleet",
            "critical",
            `${t.name} health probe FAILED (${detail}) \u2014 previously reachable, now down.`
          ));
        }
      }
    }
  }
  async handleCheckin(request) {
    const body = await request.json();
    const name = body.name;
    const machine = body.machine || "unknown";
    const workingOn = body.working_on || "";
    const context2 = body.context || "";
    const capabilities = body.capabilities || "";
    if (!name) return Response.json({ error: "name required" }, { status: 400 });
    this.ctx.storage.sql.exec(
      `INSERT INTO agents (name, status, last_checkin, working_on, machine, context, capabilities)
       VALUES (?, 'online', ?, ?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET
         status = 'online',
         last_checkin = excluded.last_checkin,
         working_on = excluded.working_on,
         machine = excluded.machine,
         context = CASE WHEN excluded.context != '' THEN excluded.context ELSE agents.context END,
         capabilities = CASE WHEN excluded.capabilities != '' THEN excluded.capabilities ELSE agents.capabilities END`,
      name,
      (/* @__PURE__ */ new Date()).toISOString(),
      workingOn,
      machine,
      context2,
      capabilities
    );
    return Response.json({ ok: true, agent: name, status: "online" });
  }
  async handlePublish(request) {
    const body = await request.json();
    const agent = body.agent;
    const items = body.items;
    if (!agent || !items || !Array.isArray(items)) {
      return Response.json({ error: "agent and items[] required" }, { status: 400 });
    }
    const ts = (/* @__PURE__ */ new Date()).toISOString();
    for (const item of items) {
      this.ctx.storage.sql.exec(
        `INSERT INTO agent_registry (agent, ts, what, location, status)
         VALUES (?, ?, ?, ?, ?)`,
        agent,
        ts,
        item.what || "",
        item.location || "",
        item.status || ""
      );
    }
    return Response.json({ ok: true, agent, published: items.length });
  }
  handleAgentQuery(name) {
    const agent = this.ctx.storage.sql.exec(
      "SELECT * FROM agents WHERE name = ?",
      name
    ).toArray();
    if (agent.length === 0) {
      return Response.json({ error: `Agent '${name}' not found` }, { status: 404 });
    }
    const registry = this.ctx.storage.sql.exec(
      "SELECT ts, what, location, status FROM agent_registry WHERE agent = ? ORDER BY ts DESC LIMIT 50",
      name
    ).toArray();
    const now = Date.now();
    const a = agent[0];
    const lastCheckin = a.last_checkin ? new Date(a.last_checkin).getTime() : 0;
    const hoursSince = Math.round((now - lastCheckin) / (1e3 * 60 * 60) * 10) / 10;
    let displayStatus = a.status;
    if (a.status === "online" && hoursSince > 2) displayStatus = "stale";
    const recentContext = this.ctx.storage.sql.exec(
      "SELECT ts, category, weight, title, tags, thread FROM context_log WHERE agent = ? ORDER BY ts DESC LIMIT 10",
      name
    ).toArray();
    return Response.json({
      name: a.name,
      status: displayStatus,
      machine: a.machine,
      working_on: a.working_on,
      context: a.context,
      capabilities: a.capabilities,
      last_checkin: a.last_checkin,
      last_checkout: a.last_checkout,
      hoursSinceCheckin: hoursSince,
      built: registry,
      recent_context: recentContext
    });
  }
  async handleCheckout(request) {
    const body = await request.json();
    const name = body.name;
    if (!name) return Response.json({ error: "name required" }, { status: 400 });
    this.ctx.storage.sql.exec(
      `UPDATE agents SET status = 'offline', last_checkout = ? WHERE name = ?`,
      (/* @__PURE__ */ new Date()).toISOString(),
      name
    );
    return Response.json({ ok: true, agent: name, status: "offline" });
  }
  handleFleet() {
    const agents = this.ctx.storage.sql.exec(
      "SELECT * FROM agents ORDER BY last_checkin DESC"
    ).toArray();
    const now = Date.now();
    const enriched = agents.map((a) => {
      const lastCheckin = a.last_checkin ? new Date(a.last_checkin).getTime() : 0;
      const hoursSince = (now - lastCheckin) / (1e3 * 60 * 60);
      let displayStatus = a.status;
      if (a.status === "online" && hoursSince > 2) displayStatus = "stale";
      return { ...a, displayStatus, hoursSinceCheckin: Math.round(hoursSince * 10) / 10 };
    });
    return Response.json({ agents: enriched });
  }
  // ─── Per-agent public daemon page ───────────────────────────────
  handleAgentDaemon(name) {
    const agent = this.ctx.storage.sql.exec(
      "SELECT * FROM agents WHERE name = ?",
      name
    ).toArray();
    if (agent.length === 0) {
      return new Response(`Agent '${name}' not found`, { status: 404 });
    }
    const registry = this.ctx.storage.sql.exec(
      "SELECT ts, what, location, status FROM agent_registry WHERE agent = ? ORDER BY ts DESC LIMIT 20",
      name
    ).toArray();
    const a = agent[0];
    const now = Date.now();
    const lastCheckin = a.last_checkin ? new Date(a.last_checkin).getTime() : 0;
    const hoursSince = Math.round((now - lastCheckin) / (1e3 * 60 * 60) * 10) / 10;
    let displayStatus = a.status;
    if (a.status === "online" && hoursSince > 2) displayStatus = "stale";
    const statusColor = displayStatus === "online" ? "#4a9" : displayStatus === "stale" ? "#ca4" : "#666";
    const registryRows = registry.map(
      (r) => `<tr><td class="dim">${(r.ts || "").split("T")[0]}</td><td>${r.what}</td><td class="dim">${r.status}</td></tr>`
    ).join("\n      ");
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${a.name} \u2014 Fleet Agent</title>
  <style>
    body { font-family: 'Berkeley Mono', 'SF Mono', monospace; background: #0a0a0a; color: #c4a35a; max-width: 700px; margin: 40px auto; padding: 0 20px; line-height: 1.6; }
    h1 { color: #e8d5a3; font-size: 1.4em; border-bottom: 1px solid #2a2a2a; padding-bottom: 12px; }
    h2 { color: #c4a35a; font-size: 1.1em; margin-top: 28px; }
    .status { color: ${statusColor}; font-weight: bold; }
    .dim { color: #666; }
    table { border-collapse: collapse; width: 100%; margin: 12px 0; }
    td, th { text-align: left; padding: 4px 12px 4px 0; font-size: 0.85em; }
    th { color: #888; }
    .meta { color: #888; font-size: 0.85em; margin: 4px 0; }
    a { color: #c4a35a; }
    .footer { margin-top: 40px; padding-top: 12px; border-top: 1px solid #2a2a2a; color: #444; font-size: 0.8em; }
  </style>
</head>
<body>
  <h1>${a.name}</h1>
  <p class="meta">Machine: ${a.machine || "unknown"} | <span class="status">${displayStatus}</span> | Last checkin: ${hoursSince}h ago</p>

  ${a.working_on ? `<h2>Currently Working On</h2><p>${a.working_on}</p>` : ""}
  ${a.context ? `<h2>Context</h2><p>${a.context}</p>` : ""}
  ${a.capabilities ? `<h2>Capabilities</h2><p>${a.capabilities}</p>` : ""}

  ${registry.length > 0 ? `
  <h2>Recently Built</h2>
  <table>
    <tr><th>Date</th><th>What</th><th>Status</th></tr>
    ${registryRows}
  </table>` : '<h2>Recently Built</h2><p class="dim">No published items yet.</p>'}

  <div class="footer">
    <a href="/daemon">&larr; Back to Fleet</a> | Neversink v1.0.0
  </div>
</body>
</html>`;
    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }
  // ─── Public daemon page ────────────────────────────────────────
  handleDaemon() {
    const lastCheck = this.getMeta("last_check_ts") || "never";
    const totalChecks = this.getMeta("total_checks") || "0";
    const repoRows = this.ctx.storage.sql.exec(
      "SELECT name, last_checked, is_private FROM repos ORDER BY last_checked DESC"
    ).toArray();
    const unreadCount = this.ctx.storage.sql.exec(
      "SELECT COUNT(*) as count FROM alerts WHERE read = 0"
    ).toArray();
    const contextCount = this.ctx.storage.sql.exec(
      "SELECT COUNT(*) as count FROM context_log"
    ).toArray();
    const highWeightCount = this.ctx.storage.sql.exec(
      "SELECT COUNT(*) as count FROM context_log WHERE weight >= 7"
    ).toArray();
    const repos = repoRows.map((r) => ({
      name: r.name,
      private: r.is_private === 1,
      lastChecked: r.last_checked
    }));
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Neversink \u2014 Persistent Awareness</title>
  <style>
    body { font-family: 'Berkeley Mono', 'SF Mono', monospace; background: #0a0a0a; color: #c4a35a; max-width: 700px; margin: 40px auto; padding: 0 20px; line-height: 1.6; }
    h1 { color: #e8d5a3; font-size: 1.4em; border-bottom: 1px solid #2a2a2a; padding-bottom: 12px; }
    h2 { color: #c4a35a; font-size: 1.1em; margin-top: 28px; }
    .status { color: #4a9; }
    .dim { color: #666; }
    .highlight { color: #e8d5a3; }
    table { border-collapse: collapse; width: 100%; margin: 12px 0; }
    td, th { text-align: left; padding: 4px 12px 4px 0; font-size: 0.85em; }
    th { color: #888; }
    .private { color: #666; }
    .public { color: #4a9; }
    a { color: #c4a35a; }
    .tagline { color: #666; font-style: italic; margin: 4px 0; }
    .footer { margin-top: 40px; padding-top: 12px; border-top: 1px solid #2a2a2a; color: #444; font-size: 0.8em; }
  </style>
</head>
<body>
  <h1>Neversink</h1>
  <p class="tagline">The stream that never goes dry. Persistent awareness for Rob's AI fleet.</p>
  <p class="dim">Evolved from Brook. Holds context across session boundaries. Monitors repos, fleet health, and agent drift.</p>

  <h2>Status</h2>
  <p><span class="status">Operational</span> | Last check: ${lastCheck} | Total checks: ${totalChecks} | Unread alerts: ${unreadCount[0]?.count || 0}</p>
  <p class="dim">Context events: <span class="highlight">${contextCount[0]?.count || 0}</span> total | <span class="highlight">${highWeightCount[0]?.count || 0}</span> high-weight (7+)</p>

  <h2>Fleet Agents</h2>
  <div id="agents">${(() => {
      const agents = this.ctx.storage.sql.exec(
        "SELECT name, status, machine, working_on, last_checkin FROM agents ORDER BY last_checkin DESC"
      ).toArray();
      if (agents.length === 0) return '<p class="dim">No agents have checked in yet.</p>';
      return "<table><tr><th>Agent</th><th>Status</th><th>Machine</th><th>Working On</th></tr>" + agents.map((a) => {
        const lc = a.last_checkin ? new Date(a.last_checkin).getTime() : 0;
        const hrs = Math.round((Date.now() - lc) / (1e3 * 60 * 60) * 10) / 10;
        let ds = a.status;
        if (ds === "online" && hrs > 2) ds = "stale";
        const sc = ds === "online" ? "#4a9" : ds === "stale" ? "#ca4" : "#666";
        return `<tr><td><a href="/daemon/${a.name}">${a.name}</a></td><td style="color:${sc}">${ds}</td><td class="dim">${a.machine || ""}</td><td class="dim">${(a.working_on || "").substring(0, 80)}</td></tr>`;
      }).join("\n    ") + "</table>";
    })()}</div>

  <h2>Monitored Repositories (${repos.length})</h2>
  <table>
    <tr><th>Repo</th><th>Visibility</th><th>Last Checked</th></tr>
    ${repos.map((r) => `<tr>
      <td>${r.name}</td>
      <td class="${r.private ? "private" : "public"}">${r.private ? "private" : "public"}</td>
      <td class="dim">${r.lastChecked || "never"}</td>
    </tr>`).join("\n    ")}
  </table>

  <h2>Capabilities</h2>
  <ul>
    <li><span class="highlight">Context persistence</span> \u2014 structured events survive session boundaries</li>
    <li><span class="highlight">Session briefings</span> \u2014 agents get full-fidelity context at startup</li>
    <li><span class="highlight">Fleet tracking</span> \u2014 agent checkin/checkout, work registry</li>
    <li><span class="highlight">Repo monitoring</span> \u2014 commit volume, new repos, large changes</li>
    <li><span class="highlight">Drift detection</span> \u2014 fleet-bridge activity, fragmentation signals</li>
    <li><span class="highlight">Context decay</span> \u2014 automatic cleanup by weight and age</li>
  </ul>

  <div class="footer">
    Neversink v1.0.0 | Cloudflare Durable Object | <a href="https://daemon.robert-chuvala.workers.dev">daemon</a> | NorthwoodsSentinel
  </div>
</body>
</html>`;
    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }
  // ─── Helpers ──────────────────────────────────────────────────
  handleStatus() {
    const lastCheck = this.getMeta("last_check_ts") || "never";
    const totalChecks = this.getMeta("total_checks") || "0";
    const unreadAlerts = this.ctx.storage.sql.exec(
      "SELECT COUNT(*) as count FROM alerts WHERE read = 0"
    ).toArray();
    const repoCount = this.ctx.storage.sql.exec(
      "SELECT COUNT(*) as count FROM repos"
    ).toArray();
    const contextCount = this.ctx.storage.sql.exec(
      "SELECT COUNT(*) as count FROM context_log"
    ).toArray();
    const recentAlerts = this.ctx.storage.sql.exec(
      "SELECT * FROM alerts WHERE read = 0 ORDER BY ts DESC LIMIT 5"
    ).toArray();
    return Response.json({
      name: "Neversink",
      version: "1.0.0",
      status: "awake",
      lastCheck,
      totalChecks: parseInt(totalChecks),
      knownRepos: repoCount[0]?.count || 0,
      unreadAlerts: unreadAlerts[0]?.count || 0,
      contextEvents: contextCount[0]?.count || 0,
      recentAlerts
    });
  }
  handleAlerts(url) {
    const unreadOnly = url.searchParams.get("unread") !== "false";
    const where = unreadOnly ? "WHERE read = 0" : "";
    const rows = this.ctx.storage.sql.exec(
      `SELECT * FROM alerts ${where} ORDER BY ts DESC LIMIT 50`
    ).toArray();
    return Response.json(rows);
  }
  makeAlert(type, severity, message) {
    return {
      id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ts: (/* @__PURE__ */ new Date()).toISOString(),
      type,
      severity,
      message,
      read: false
    };
  }
  getMeta(key) {
    const rows = this.ctx.storage.sql.exec(
      "SELECT value FROM meta WHERE key = ?",
      key
    ).toArray();
    return rows.length > 0 ? rows[0].value : null;
  }
  setMeta(key, value) {
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
      key,
      value
    );
  }
  /**
   * Push notification via ntfy.sh. Non-blocking — never throws.
   */
  async sendPush(title2, body, priority = 3, tags = "") {
    const topic = this.env.NTFY_TOPIC;
    if (!topic) return;
    try {
      await fetch(`https://ntfy.sh/${topic}`, {
        method: "POST",
        headers: {
          "Title": title2,
          "Priority": String(priority),
          "Tags": tags || "satellite"
        },
        body
      });
    } catch {
    }
  }
  /**
   * Check for active fires in context_log and push reminders.
   */
  async pushActiveFires() {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const fires = this.ctx.storage.sql.exec(
      `SELECT title, body, expires FROM context_log
       WHERE category = 'fire' AND weight >= 7
       AND (expires = '' OR expires > ?)
       ORDER BY weight DESC LIMIT 5`,
      now
    ).toArray();
    for (const fire of fires) {
      const f = fire;
      const exp = f.expires ? ` (due: ${f.expires.split("T")[0]})` : "";
      await this.sendPush(
        `\u{1F525} ${f.title}`,
        `${f.body}${exp}`,
        4,
        // high priority
        "fire,warning"
      );
    }
  }
};
var index_default = {
  async fetch(request, env2) {
    const id = env2.BROOK.idFromName("brook-singleton");
    const stub = env2.BROOK.get(id);
    return stub.fetch(request);
  },
  async scheduled(event, env2, ctx) {
    const id = env2.BROOK.idFromName("brook-singleton");
    const stub = env2.BROOK.get(id);
    ctx.waitUntil(stub.fetch(new Request("https://neversink/check")));
  }
};
export {
  Brook,
  index_default as default
};
//# sourceMappingURL=index.js.map

--030ce0ad384ebef5152d1a2bf32a1783811d1cf2b7124896ad71b69d488b--

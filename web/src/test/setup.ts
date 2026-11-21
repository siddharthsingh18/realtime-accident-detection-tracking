import "@testing-library/jest-dom";

// Mock localStorage for Node 22 environment
const storage: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => storage[key] ?? null,
  setItem: (key: string, value: string) => {
    storage[key] = String(value);
  },
  removeItem: (key: string) => {
    delete storage[key];
  },
  clear: () => {
    Object.keys(storage).forEach((k) => delete storage[k]);
  },
  key: (i: number) => Object.keys(storage)[i] ?? null,
  length: 0,
};

Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  writable: true,
});
Object.defineProperty(global, "localStorage", {
  value: localStorageMock,
  writable: true,
});

// Mock matchMedia
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// Mock HTMLCanvasElement.getContext
HTMLCanvasElement.prototype.getContext = (() => {
  return {
    fillRect: () => {},
    clearRect: () => {},
    getImageData: () => ({ data: new Array(4) }),
    putImageData: () => {},
    createImageData: () => [],
    setTransform: () => {},
    drawImage: () => {},
    save: () => {},
    fillText: () => {},
    restore: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    stroke: () => {},
    strokeRect: () => {},
    measureText: () => ({ width: 50 }),
  } as unknown as CanvasRenderingContext2D;
}) as unknown as typeof HTMLCanvasElement.prototype.getContext;

// Mock HTMLCanvasElement.toBlob
HTMLCanvasElement.prototype.toBlob = function (callback, type = "image/jpeg") {
  callback(new Blob([], { type }));
};

// Mock createImageBitmap
global.createImageBitmap = (async () => {
  return {
    width: 640,
    height: 360,
    close: () => {},
  } as unknown as ImageBitmap;
}) as unknown as typeof createImageBitmap;

// Mock ResizeObserver
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Mock URL.createObjectURL and revokeObjectURL
if (!URL.createObjectURL) {
  URL.createObjectURL = () => "blob:http://localhost/mock-url";
  URL.revokeObjectURL = () => {};
}

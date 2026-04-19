const Module = require("module");
const originalLoad = Module._load;

function multerShim() {
  const middleware = () => (req, _res, next) => {
    if (!Array.isArray(req.files)) req.files = [];
    if (!req.file) req.file = null;
    next();
  };

  return {
    single: middleware,
    array: middleware,
    fields: middleware,
    none: middleware,
    any: middleware,
  };
}

multerShim.diskStorage = function diskStorage() {
  return {};
};

multerShim.memoryStorage = function memoryStorage() {
  return {};
};

Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "multer") {
    return multerShim;
  }
  return originalLoad.call(this, request, parent, isMain);
};

require("./index.js");

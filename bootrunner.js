"use strict";
const fs = require("fs");
const path = require("path");

const bootPath = path.join(__dirname, "boot.js");
let source = fs.readFileSync(bootPath, "utf8");

// boot.js contains a nested template-literal typo in the generated cmdModels function.
// Fix only that syntax before evaluating the otherwise proven bootstrap.
source = source.replace(
  '    `Your plan: ${plan.toUpperCase()}`,' ,
  '    "Your plan: " + plan.toUpperCase(),'
);

// Fail loudly if the known syntax defect is still present.
if (source.includes('`Your plan: ${plan.toUpperCase()}`,') ) {
  throw new Error("Studio bootstrap syntax patch was not applied");
}

eval(source);

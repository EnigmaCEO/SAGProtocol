"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.canonicalKeccak = exports.sortedJson = void 0;
const ethers_1 = require("ethers");
const canonicalHash_1 = require("../../packages/escrow-protocol/src/canonicalHash");
Object.defineProperty(exports, "sortedJson", { enumerable: true, get: function () { return canonicalHash_1.sortedJson; } });
exports.canonicalKeccak = (0, canonicalHash_1.makeCanonicalKeccak)((data) => (0, ethers_1.keccak256)(data), (text) => (0, ethers_1.toUtf8Bytes)(text));

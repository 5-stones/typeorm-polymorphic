"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RepositoryNotFoundException = void 0;
class RepositoryNotFoundException extends Error {
    constructor(token) {
        super(`Repository cannot be found for given token [${token}]`);
    }
}
exports.RepositoryNotFoundException = RepositoryNotFoundException;

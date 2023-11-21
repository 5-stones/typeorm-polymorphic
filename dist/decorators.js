"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PolymorphicRepository = exports.PolymorphicParent = exports.PolymorphicChildren = void 0;
const constants_1 = require("./constants");
const polymorphicPropertyDecorator = (options) => (target, propertyKey) => {
    Reflect.defineMetadata(constants_1.POLYMORPHIC_OPTIONS, true, target);
    Reflect.defineMetadata(`${constants_1.POLYMORPHIC_OPTIONS}${constants_1.POLYMORPHIC_KEY_SEPARATOR}${propertyKey}`, Object.assign({ propertyKey }, options), target);
};
const PolymorphicChildren = (classType, options = {}) => polymorphicPropertyDecorator(Object.assign({ type: 'children', classType, hasMany: true, eager: true, cascade: true, deleteBeforeUpdate: false }, options));
exports.PolymorphicChildren = PolymorphicChildren;
const PolymorphicParent = (classType, options = {}) => polymorphicPropertyDecorator(Object.assign({ type: 'parent', classType, hasMany: false, eager: true, cascade: true, deleteBeforeUpdate: false }, options));
exports.PolymorphicParent = PolymorphicParent;
const PolymorphicRepository = (entity) => (target, _key, descriptor) => {
    if (descriptor) {
        Reflect.defineMetadata(constants_1.POLYMORPHIC_REPOSITORY, entity, descriptor.value);
        return descriptor;
    }
    Reflect.defineMetadata(constants_1.POLYMORPHIC_REPOSITORY, entity, target);
    return target;
};
exports.PolymorphicRepository = PolymorphicRepository;

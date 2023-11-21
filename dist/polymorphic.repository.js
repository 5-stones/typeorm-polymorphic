"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AbstractPolymorphicRepository = void 0;
require("reflect-metadata");
const typeorm_1 = require("typeorm");
const constants_1 = require("./constants");
const repository_token_exception_1 = require("./repository.token.exception");
const constants_2 = require("./constants");
const entityTypeColumn = (options) => options.entityTypeColumn || 'entityType';
const entityIdColumn = (options) => options.entityTypeId || 'entityId';
const PrimaryColumn = (options) => options.primaryColumn || 'id';
class AbstractPolymorphicRepository extends typeorm_1.Repository {
    static createRepository(ds, repository) {
        const entity = Reflect.getMetadata(constants_2.POLYMORPHIC_REPOSITORY, repository);
        const baseRepository = ds.getRepository(entity);
        return new repository(baseRepository.target, baseRepository.manager, baseRepository.queryRunner);
    }
    getPolymorphicMetadata() {
        const keys = Reflect.getMetadataKeys(this.metadata.target['prototype']);
        if (!keys) {
            return [];
        }
        return keys.reduce((keys, key) => {
            if (key.split(constants_1.POLYMORPHIC_KEY_SEPARATOR)[0] === constants_1.POLYMORPHIC_OPTIONS) {
                const data = Reflect.getMetadata(key, this.metadata.target['prototype']);
                if (data && typeof data === 'object') {
                    const classType = data.classType();
                    keys.push(Object.assign(Object.assign({}, data), { classType }));
                }
            }
            return keys;
        }, []);
    }
    isPolymorph() {
        return Reflect.hasOwnMetadata(constants_1.POLYMORPHIC_OPTIONS, this.metadata.target['prototype']);
    }
    isChildren(options) {
        return options.type === 'children';
    }
    isParent(options) {
        return options.type === 'parent';
    }
    hydrateMany(entities) {
        return __awaiter(this, void 0, void 0, function* () {
            const metadata = this.getPolymorphicMetadata();
            return this.hydratePolymorphs(entities, metadata);
        });
    }
    hydrateOne(entity) {
        return __awaiter(this, void 0, void 0, function* () {
            const result = yield this.hydrateMany([entity]);
            return result[0];
        });
    }
    hydratePolymorphs(entities, options) {
        return __awaiter(this, void 0, void 0, function* () {
            const values = yield Promise.all(options.map((option) => this.hydrateEntities(entities, option)));
            const results = [];
            for (let entity of entities) {
                const result = values.reduce((e, vals) => {
                    const polyKey = `${e.entityType}:${e.entityId}`;
                    const polys = vals.hasMany
                        ? vals.valueKeyMap[polyKey]
                        : vals.valueKeyMap[polyKey][0];
                    const key = vals.key;
                    e[key] = polys;
                    return e;
                }, entity);
                results.push(result);
            }
            return results;
        });
    }
    hydrateEntities(entities, options) {
        return __awaiter(this, void 0, void 0, function* () {
            const typeColumn = entityTypeColumn(options);
            const entityTypes = options.type === 'parent'
                ? [...new Set(entities.map((e) => e[typeColumn]))]
                : Array.isArray(options.classType)
                    ? options.classType
                    : [options.classType];
            // TODO if not hasMany, should I return if one is found?
            const results = yield Promise.all(entityTypes.map((type) => this.findPolymorphs(entities, type, options)));
            const idColumn = entityIdColumn(options);
            const isParent = this.isParent(options);
            const primaryColumn = PrimaryColumn(options);
            const entitiesResultMap = results
                // flatten all the results
                .reduce((acc, val) => {
                if (Array.isArray(val)) {
                    acc.push(...val);
                }
                else {
                    acc.push(val);
                }
                return acc;
            }, [])
                // map the results to a keyed map by entityType & entityId
                .reduce((acc, val) => {
                let key;
                if (isParent) {
                    const [pColumnVal, entityType] = Array.isArray(val)
                        ? [val[0][primaryColumn], val[0].constructor.name]
                        : [val[primaryColumn], val.constructor.name];
                    key = `${entityType}:${pColumnVal}`;
                }
                else {
                    const [idColumnVal, typeColumnVal] = Array.isArray(val)
                        ? [val[0][idColumn], val[0][typeColumn]]
                        : [val[idColumn], val[typeColumn]];
                    key = `${typeColumnVal}:${idColumnVal}`;
                }
                acc[key] = acc[key] || [];
                acc[key].push(val);
                return acc;
            }, {});
            return {
                key: options.propertyKey,
                type: options.type,
                hasMany: options.hasMany,
                valueKeyMap: entitiesResultMap,
            };
        });
    }
    findPolymorphs(entities, entityType, options) {
        return __awaiter(this, void 0, void 0, function* () {
            const repository = this.findRepository(entityType);
            const idColumn = entityIdColumn(options);
            const primaryColumn = PrimaryColumn(options);
            // filter out any entities that don't match the given entityType
            const filteredEntities = entities.filter((e) => {
                return repository.target.toString() === e.entityType;
            });
            const method = options.hasMany || filteredEntities.length > 1 ? 'find' : 'findOne';
            return repository[method](options.type === 'parent'
                ? {
                    where: {
                        // TODO: Not sure about this change (key was just id before)
                        [primaryColumn]: (0, typeorm_1.In)(filteredEntities.map((p) => p[idColumn])),
                    },
                }
                : {
                    where: {
                        [idColumn]: (0, typeorm_1.In)(filteredEntities.map((p) => p[primaryColumn])),
                        [entityTypeColumn(options)]: entityType,
                    },
                });
        });
    }
    findRepository(entityType) {
        const repositoryToken = this.resolveRepositoryToken(entityType);
        const repository = repositoryToken !== entityType
            ? this.manager.getCustomRepository(repositoryToken)
            : this.manager.getRepository(repositoryToken);
        if (!repository) {
            throw new repository_token_exception_1.RepositoryNotFoundException(repositoryToken);
        }
        return repository;
    }
    resolveRepositoryToken(token) {
        const tokens = (0, typeorm_1.getMetadataArgsStorage)().entityRepositories.filter((value) => value.entity === token);
        return tokens[0] ? tokens[0].target : token;
    }
    save(entityOrEntities, options) {
        const _super = Object.create(null, {
            save: { get: () => super.save }
        });
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.isPolymorph()) {
                return Array.isArray(entityOrEntities)
                    ? _super.save.call(this, entityOrEntities, options)
                    : _super.save.call(this, entityOrEntities, options);
            }
            const metadata = this.getPolymorphicMetadata();
            metadata.map((options) => {
                if (this.isParent(options)) {
                    (Array.isArray(entityOrEntities)
                        ? entityOrEntities
                        : [entityOrEntities]).map((entity) => {
                        const parent = entity[options.propertyKey];
                        if (!parent || entity[entityIdColumn(options)] !== undefined) {
                            return entity;
                        }
                        entity[entityIdColumn(options)] =
                            parent[PrimaryColumn(options)];
                        entity[entityTypeColumn(options)] =
                            parent.constructor.name;
                        return entity;
                    });
                }
            });
            /**
             * Check deleteBeforeUpdate
             */
            Array.isArray(entityOrEntities)
                ? yield Promise.all(entityOrEntities.map((entity) => this.deletePolymorphs(entity, metadata)))
                : yield this.deletePolymorphs(entityOrEntities, metadata);
            return Array.isArray(entityOrEntities)
                ? _super.save.call(this, entityOrEntities, options)
                : _super.save.call(this, entityOrEntities, options);
        });
    }
    deletePolymorphs(entity, options) {
        return __awaiter(this, void 0, void 0, function* () {
            yield Promise.all(options.map((option) => new Promise((resolve) => {
                if (!option.deleteBeforeUpdate) {
                    resolve(Promise.resolve());
                }
                const entityTypes = Array.isArray(option.classType)
                    ? option.classType
                    : [option.classType];
                // resolve to singular query?
                resolve(Promise.all(entityTypes.map((type) => {
                    const repository = this.findRepository(type);
                    repository.delete({
                        [entityTypeColumn(option)]: type,
                        [entityIdColumn(option)]: entity[PrimaryColumn(option)],
                    });
                })));
            })));
        });
    }
    find(options) {
        const _super = Object.create(null, {
            find: { get: () => super.find }
        });
        return __awaiter(this, void 0, void 0, function* () {
            const results = yield _super.find.call(this, options);
            if (!this.isPolymorph()) {
                return results;
            }
            const metadata = this.getPolymorphicMetadata();
            return this.hydratePolymorphs(results, metadata);
        });
    }
    findOne(options) {
        const _super = Object.create(null, {
            findOne: { get: () => super.findOne }
        });
        return __awaiter(this, void 0, void 0, function* () {
            const polymorphicMetadata = this.getPolymorphicMetadata();
            if (Object.keys(polymorphicMetadata).length === 0) {
                return _super.findOne.call(this, options);
            }
            const entity = yield _super.findOne.call(this, options);
            if (!entity) {
                return entity;
            }
            const results = yield this.hydratePolymorphs([entity], polymorphicMetadata);
            return results[0];
        });
    }
    create(plainEntityLikeOrPlainEntityLikes) {
        const metadata = this.getPolymorphicMetadata();
        const entity = super.create(plainEntityLikeOrPlainEntityLikes);
        if (!metadata) {
            return entity;
        }
        metadata.forEach((value) => {
            entity[value.propertyKey] =
                plainEntityLikeOrPlainEntityLikes[value.propertyKey];
        });
        return entity;
    }
}
exports.AbstractPolymorphicRepository = AbstractPolymorphicRepository;

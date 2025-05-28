import 'reflect-metadata';
import {
  Brackets,
  DataSource,
  DeepPartial,
  FindManyOptions,
  FindOneOptions,
  getMetadataArgsStorage,
  In,
  ObjectLiteral,
  Repository,
  SaveOptions,
} from 'typeorm';
import { POLYMORPHIC_KEY_SEPARATOR, POLYMORPHIC_OPTIONS } from './constants';
import {
  PolymorphicChildType,
  PolymorphicParentType,
  PolymorphicChildInterface,
  PolymorphicOptionsType,
  PolymorphicMetadataInterface,
  PolymorphicMetadataOptionsInterface,
} from './polymorphic.interface';
import { EntityRepositoryMetadataArgs } from 'typeorm/metadata-args/EntityRepositoryMetadataArgs';
import { RepositoryNotFoundException } from './repository.token.exception';
import { POLYMORPHIC_REPOSITORY } from './constants';

const entityTypeColumn = (options: PolymorphicMetadataInterface): string =>
  options.entityTypeColumn || 'entityType';
const entityIdColumn = (options: PolymorphicMetadataInterface): string =>
  options.entityIdColumn || 'entityId';
const PrimaryColumn = (options: PolymorphicMetadataInterface): string =>
  options.primaryColumn || 'id';

export abstract class AbstractPolymorphicRepository<
  E extends ObjectLiteral,
> extends Repository<E> {
  public static createRepository(
    ds: DataSource,
    repository: new (...args: any[]) => any,
  ) {
    const entity = Reflect.getMetadata(POLYMORPHIC_REPOSITORY, repository);
    const baseRepository = ds.getRepository<any>(entity);
    return new repository(
      baseRepository.target,
      baseRepository.manager,
      baseRepository.queryRunner,
    );
  }

  private getPolymorphicMetadata(): Array<PolymorphicMetadataInterface> {
    const keys = Reflect.getMetadataKeys(
      (this.metadata.target as Function)['prototype'],
    );

    if (!keys) {
      return [];
    }

    return keys.reduce<Array<PolymorphicMetadataInterface>>(
      (keys: PolymorphicMetadataInterface[], key: string) => {
        if (key.split(POLYMORPHIC_KEY_SEPARATOR)[0] === POLYMORPHIC_OPTIONS) {
          const data: PolymorphicMetadataOptionsInterface & {
            propertyKey: string;
          } = Reflect.getMetadata(
            key,
            (this.metadata.target as Function)['prototype'],
          );

          if (data && typeof data === 'object') {
            const classType = data.classType();
            keys.push({
              ...data,
              classType,
            });
          }
        }

        return keys;
      },
      [],
    );
  }

  protected isPolymorph(): boolean {
    return Reflect.hasOwnMetadata(
      POLYMORPHIC_OPTIONS,
      (this.metadata.target as Function)['prototype'],
    );
  }

  protected isChildren(
    options: PolymorphicChildType | PolymorphicParentType,
  ): options is PolymorphicChildType {
    return options.type === 'children';
  }

  protected isParent(
    options: PolymorphicChildType | PolymorphicParentType,
  ): options is PolymorphicParentType {
    return options.type === 'parent';
  }

  public async hydrateMany(entities: E[]): Promise<E[]> {
    return this.hydratePolymorphs(entities);
  }

  public async hydrateOne(entity: E): Promise<E> {
    return (await this.hydratePolymorphs([entity]))[0];
  }

  private async hydratePolymorphs(entities: E[]) {
    if (!this.isPolymorph()) {
      return entities;
    }

    const metadata = this.getPolymorphicMetadata();
    const groupedMetadata = metadata.reduce<
      Record<
        string,
        {
          entityType: Function;
          metadata: PolymorphicMetadataInterface[];
        }
      >
    >((acc, meta) => {
      const entityTypes = this.getEntityTypes(meta);
      for (const entityType of entityTypes) {
        acc[entityType.name] = acc[entityType.name] || {
          entityType,
          metadata: [],
        };

        acc[entityType.name].metadata.push(meta);
      }
      return acc;
    }, {});

    const groupedMetadataKeys = Object.keys(groupedMetadata);
    for (const key of groupedMetadataKeys) {
      // hydrate each entityType in batch based on the associated metadata/properties
      const { entityType, metadata } = groupedMetadata[key];
      await this.findAndHydrateEntityTypeForPolymorphicOptions({
        entities,
        entityType,
        metadata,
      });
    }

    return entities;
  }

  private async findAndHydrateEntityTypeForPolymorphicOptions({
    entities,
    entityType,
    metadata,
  }: {
    entities: E[];
    entityType: Function;
    metadata: PolymorphicMetadataInterface[];
  }) {
    /**
     * Fetch the polymorphs for the given entityType, it's corresponding
     * metadata options, and the set of entities we're hydrating.
     */
    const repository = this.findRepository(entityType);
    const query = repository.createQueryBuilder('p');

    for (const options of metadata) {
      if (this.isParent(options)) {
        const parentIds = entities
          .filter((entity) => {
            return entity[entityTypeColumn(options)] === entityType.name;
          })
          .reduce((set, entity) => {
            set.add(entity[entityIdColumn(options)]);
            return set;
          }, new Set<number>());
        query.orWhere({
          [PrimaryColumn(options)]: In([...parentIds]),
        });
      } else {
        const entityIds = entities.reduce((set, entity) => {
          set.add(entity[this.getRepositoryEntityPrimaryColumn()]);
          return set;
        }, new Set<number>());
        query.orWhere(
          new Brackets((qb) => {
            const idColumn = entityIdColumn(options);
            const typeColumn = entityTypeColumn(options);
            qb.where(`p.${idColumn} IN (:...ids)`, {
              ids: [...entityIds],
            }).andWhere(`p.${typeColumn} = :entityType`, {
              entityType: entities[0].constructor.name,
            });
          }),
        );
      }
    }

    /**
     * Map the fetched polymorphs into their appropriate entities for each
     * metadata option.
     */
    const polymorphsIdColumn =
      this.getRepositoryEntityPrimaryColumn(repository);
    const polymorphs = await query.getMany();
    const polymorphsIdColumnMap = polymorphs.reduce((acc, poly) => {
      acc[poly[polymorphsIdColumn].toString()] = poly;
      return acc;
    }, {});

    for (const options of metadata) {
      const key = options.propertyKey as keyof E;

      if (this.isParent(options)) {
        const idColumn = entityIdColumn(options);
        const entitiesToHydrate = entities.reduce((acc, entity) => {
          const isMatch = entity[entityTypeColumn(options)] === entityType.name;
          if (isMatch) {
            acc.push(entity);
          } else if (entity[key] === undefined) {
            entity[key] = null;
          }
          return acc;
        }, []);

        entitiesToHydrate.forEach((entity) => {
          const poly = polymorphsIdColumnMap[entity[idColumn].toString()];

          if (!poly) return;
          if (options.hasMany) {
            entity[key] = entity[key] || ([] as E[keyof E]);
            entity[key].push(poly);
          } else {
            entity[key] = poly;
          }
        });
      } else {
        const idColumn = entityIdColumn(options);
        const polymorphsEntityIdMap = polymorphs.reduce<
          Record<string, PolymorphicChildInterface[]>
        >((acc, poly) => {
          const resolvedValue = poly[idColumn];
          if (resolvedValue !== null || resolvedValue === undefined) {
            const resolvedValueKey = resolvedValue.toString();
            acc[resolvedValueKey] = acc[resolvedValueKey] || [];
            acc[resolvedValueKey].push(poly);
          }
          return acc;
        }, {});
        entities.forEach((entity) => {
          const entityId =
            entity[this.getRepositoryEntityPrimaryColumn()].toString();
          const polymorphs = polymorphsEntityIdMap[entityId];

          if (!polymorphs || !polymorphs.length) return;
          if (options.hasMany) {
            entity[key] = polymorphs as E[keyof E];
          } else {
            entity[key] = polymorphs[0] as E[keyof E];
          }
        });
      }
    }
  }

  private getEntityTypes(options: PolymorphicMetadataInterface): Function[] {
    const entityTypes = new Set<Function>();
    if (Array.isArray(options.classType)) {
      options.classType.forEach((classType) => {
        entityTypes.add(classType);
      });
    } else {
      entityTypes.add(options.classType);
    }

    return [...entityTypes];
  }

  private getRepositoryEntityPrimaryColumn(repository: Repository<any> = this) {
    const primaryColumnProperty =
      repository.metadata.primaryColumns[0].propertyName;
    return primaryColumnProperty;
  }

  private findRepository(
    entityType: Function,
  ): Repository<PolymorphicChildInterface | never> {
    const repositoryToken = this.resolveRepositoryToken(entityType);

    const repository: Repository<PolymorphicChildInterface> =
      repositoryToken !== entityType
        ? this.manager.getCustomRepository(repositoryToken)
        : this.manager.getRepository(repositoryToken);

    if (!repository) {
      throw new RepositoryNotFoundException(repositoryToken);
    }

    return repository;
  }

  private resolveRepositoryToken(token: Function): Function | never {
    const tokens = getMetadataArgsStorage().entityRepositories.filter(
      (value: EntityRepositoryMetadataArgs) => value.entity === token,
    );
    return tokens[0] ? tokens[0].target : token;
  }

  save<T extends DeepPartial<E>>(
    entities: T[],
    options: SaveOptions & {
      reload: false;
    },
  ): Promise<T[]>;

  save<T extends DeepPartial<E>>(
    entities: T[],
    options?: SaveOptions,
  ): Promise<(T & E)[]>;

  save<T extends DeepPartial<E>>(
    entity: T,
    options?: SaveOptions & {
      reload: false;
    },
  ): Promise<T>;

  public async save<T extends DeepPartial<E>>(
    entityOrEntities: T | Array<T>,
    options?: SaveOptions & { reload: false },
  ): Promise<(T & E) | Array<T & E> | T | Array<T>> {
    if (!this.isPolymorph()) {
      return Array.isArray(entityOrEntities)
        ? super.save(entityOrEntities, options)
        : super.save(entityOrEntities, options);
    }

    const metadata = this.getPolymorphicMetadata();

    metadata.map((options: PolymorphicOptionsType) => {
      if (this.isParent(options)) {
        (Array.isArray(entityOrEntities)
          ? entityOrEntities
          : [entityOrEntities]
        ).map((entity: E | DeepPartial<E>) => {
          const parent = entity[options.propertyKey];

          if (!parent) {
            return entity;
          }

          /**
           * Add parent's id and type to child's id and type field
           */
          type EntityKey = keyof DeepPartial<E>;
          entity[entityIdColumn(options) as EntityKey] =
            parent[PrimaryColumn(options)];
          entity[entityTypeColumn(options) as EntityKey] =
            parent.constructor.name;
          return entity;
        });
      }
    });

    /**
     * Check deleteBeforeUpdate
     */
    Array.isArray(entityOrEntities)
      ? await Promise.all(
          (entityOrEntities as Array<T>).map((entity) =>
            this.deletePolymorphs(entity, metadata),
          ),
        )
      : await this.deletePolymorphs(entityOrEntities as T, metadata);

    return Array.isArray(entityOrEntities)
      ? super.save(entityOrEntities, options)
      : super.save(entityOrEntities, options);
  }

  private async deletePolymorphs(
    entity: DeepPartial<E>,
    options: PolymorphicMetadataInterface[],
  ): Promise<void | never> {
    await Promise.all(
      options.map(
        (option: PolymorphicMetadataInterface) =>
          new Promise((resolve) => {
            if (!option.deleteBeforeUpdate) {
              resolve(Promise.resolve());
            }

            const entityTypes = Array.isArray(option.classType)
              ? option.classType
              : [option.classType];

            // resolve to singular query?
            resolve(
              Promise.all(
                entityTypes.map((type: () => Function | Function[]) => {
                  const repository = this.findRepository(type);

                  repository.delete({
                    [entityTypeColumn(option)]: type,
                    [entityIdColumn(option)]: entity[PrimaryColumn(option)],
                  });
                }),
              ),
            );
          }),
      ),
    );
  }

  public async find(options?: FindManyOptions<E>): Promise<E[]> {
    const results = await super.find(options);

    if (!this.isPolymorph()) {
      return results;
    }

    return this.hydratePolymorphs(results);
  }

  public async findOne(options?: FindOneOptions<E>): Promise<E | null> {
    const polymorphicMetadata = this.getPolymorphicMetadata();

    if (Object.keys(polymorphicMetadata).length === 0) {
      return super.findOne(options);
    }

    const entity = await super.findOne(options);

    if (!entity) {
      return entity;
    }

    return (await this.hydratePolymorphs([entity]))[0];
  }

  create(): E;

  create(entityLikeArray: DeepPartial<E>[]): E[];

  create(entityLike: DeepPartial<E>): E;

  create(
    plainEntityLikeOrPlainEntityLikes?: DeepPartial<E> | DeepPartial<E>[],
  ): E | E[] {
    const metadata = this.getPolymorphicMetadata();
    const entity = super.create(plainEntityLikeOrPlainEntityLikes as any);
    if (!metadata) {
      return entity;
    }
    metadata.forEach((value: PolymorphicOptionsType) => {
      entity[value.propertyKey] =
        plainEntityLikeOrPlainEntityLikes[value.propertyKey];
    });

    return entity;
  }

  /// TODO implement remove and have an option to delete children/parent
}

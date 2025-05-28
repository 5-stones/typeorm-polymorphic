import { DataSource, DeepPartial } from 'typeorm';
import { AdvertEntity } from './entities/advert.entity';
import { UserEntity } from './entities/user.entity';
import { config } from 'dotenv';
import { resolve } from 'path';
import { AdvertRepository } from './repository/advert.repository';
import { AbstractPolymorphicRepository } from '../';
import { MerchantEntity } from './entities/merchant.entity';
import { UserRepository } from './repository/user.repository';

describe('AbstractPolymorphicRepository', () => {
  let connection: DataSource;

  beforeAll(async () => {
    config({
      path: resolve(__dirname, '.', '..', '..', '.env'),
    });

    connection = new DataSource({
      type: 'mysql',
      host: process.env.TYPEORM_HOST,
      port: parseInt(process.env.TYPEORM_PORT as string, 10),
      username: process.env.TYPEORM_USERNAME,
      password: process.env.TYPEORM_PASSWORD,
      entities: [UserEntity, AdvertEntity, MerchantEntity],
      synchronize: process.env.TYPEORM_SYNCHRONIZE === 'true',
      database: process.env.TYPEORM_DATABASE,
    });
    await connection.initialize();
  });

  afterAll(async () => {
    await connection.destroy();
  });

  afterEach(async () => {
    const userRepository = connection.getRepository(UserEntity);
    const repository = connection.getRepository(AdvertEntity);

    await userRepository.createQueryBuilder().delete().execute();
    await repository.createQueryBuilder().delete().execute();
  });

  describe('Childen', () => {
    describe('create', () => {
      it('Can create with parent', async () => {
        const repository = AbstractPolymorphicRepository.createRepository(
          connection,
          AdvertRepository,
        );

        const user = new UserEntity();

        const result = repository.create({
          owner: user,
        });

        expect(result).toBeInstanceOf(AdvertEntity);
        expect(result.owner).toBeInstanceOf(UserEntity);
      });
    });

    describe('save', () => {
      it('Can save cascade parent', async () => {
        const repository = AbstractPolymorphicRepository.createRepository(
          connection,
          AdvertRepository,
        );
        const userRepository = connection.getRepository(UserEntity);

        const user = await userRepository.save(new UserEntity());

        const result = await repository.save(
          repository.create({
            owner: user,
          }),
        );

        expect(result).toBeInstanceOf(AdvertEntity);
        expect(result.owner).toBeInstanceOf(UserEntity);
        expect(result.id).toBeTruthy();
        expect(result.owner.id).toBeTruthy();
        expect(result.entityType).toBe(UserEntity.name);
        expect(result.entityId).toBe(result.owner.id);
      });

      it('Can update parent', async () => {
        const repository = AbstractPolymorphicRepository.createRepository(
          connection,
          AdvertRepository,
        );
        const userRepository = connection.getRepository(UserEntity);

        const user = await userRepository.save(new UserEntity());

        const result = await repository.save(
          repository.create({
            owner: user,
          }),
        );

        const otherUser = await userRepository.save(new UserEntity());
        result.owner = otherUser;
        await repository.save(result);

        expect(result).toBeInstanceOf(AdvertEntity);
        expect(result.owner).toBeInstanceOf(UserEntity);
        expect(result.id).toBeTruthy();
        expect(result.owner.id).toBeTruthy();
        expect(result.entityType).toBe(UserEntity.name);
        expect(result.entityId).toBe(otherUser.id);
      });

      it('Can save many with cascade parent', async () => {
        const repository = AbstractPolymorphicRepository.createRepository(
          connection,
          AdvertRepository,
        );
        const userRepository = connection.getRepository(UserEntity);

        const user = await userRepository.save(new UserEntity());

        const result = await repository.save([
          repository.create({
            owner: user,
          }),
          repository.create({
            owner: user,
          }),
        ]);

        result.forEach((res) => {
          expect(res).toBeInstanceOf(AdvertEntity);
          expect(res.owner).toBeInstanceOf(UserEntity);
          expect(res.id).toBeTruthy();
          expect(res.owner.id).toBeTruthy();
          expect(res.entityType).toBe(UserEntity.name);
          expect(res.entityId).toBe(res.owner.id);
        });
      });
    });

    describe('findOne', () => {
      it('Can find entity with parent', async () => {
        const repository = AbstractPolymorphicRepository.createRepository(
          connection,
          AdvertRepository,
        );
        const userRepository = connection.getRepository(UserEntity);

        const user = await userRepository.save(new UserEntity());

        const advert = await repository.save(
          repository.create({
            owner: user,
          }),
        );

        const result = await repository.findOne({ where: { id: advert.id } });

        expect(result).toBeInstanceOf(AdvertEntity);
        expect(result?.owner).toBeInstanceOf(UserEntity);
        expect(result?.owner.id).toBe(result?.entityId);
        expect(result?.entityType).toBe(UserEntity.name);
      });

      it('Can find entity without parent', async () => {
        const repository = AbstractPolymorphicRepository.createRepository(
          connection,
          AdvertRepository,
        );

        const advert = await repository.save(repository.create({}));

        const result = await repository.findOne({ where: { id: advert.id } });

        expect(result).toBeInstanceOf(AdvertEntity);
        expect(result?.owner).toBeNull();
        expect(result?.entityId).toBeNull();
        expect(result?.entityType).toBeNull();
      });

      it('Can find entity with customized entity and id columns', async () => {
        const repository = AbstractPolymorphicRepository.createRepository(
          connection,
          AdvertRepository,
        );
        const userRepository = connection.getRepository(UserEntity);

        const user = await userRepository.save(new UserEntity());

        const advert = await repository.save(
          repository.create({
            creator: user,
          }),
        );

        const result = await repository.findOne({ where: { id: advert.id } });

        expect(result).toBeInstanceOf(AdvertEntity);

        expect(result?.creator).toBeInstanceOf(UserEntity);
        expect(result?.creator.id).toBe(result?.creatorId);
        expect(result?.creatorType).toBe(UserEntity.name);
        expect(result?.creatorId).toBe(result?.creator.id);
      });
    });

    describe('find', () => {
      it('Can find entities with parent', async () => {
        const repository = AbstractPolymorphicRepository.createRepository(
          connection,
          AdvertRepository,
        );
        const userRepository = connection.getRepository(UserEntity);

        const user = await userRepository.save(new UserEntity());

        await repository.save([
          repository.create({
            owner: user,
          }),
          repository.create({
            owner: user,
          }),
        ]);

        const result = await repository.find();

        result.forEach((res) => {
          expect(res).toBeInstanceOf(AdvertEntity);
          expect(res.owner).toBeInstanceOf(UserEntity);
          expect(res.id).toBeTruthy();
          expect(res.owner.id).toBeTruthy();
          expect(res.entityType).toBe(UserEntity.name);
          expect(res.entityId).toBe(res.owner.id);
        });
      });

      it('Can find entities without parent', async () => {
        const repository = AbstractPolymorphicRepository.createRepository(
          connection,
          AdvertRepository,
        );

        await repository.save([repository.create({}), repository.create({})]);

        const result = await repository.find();

        result.forEach((res) => {
          expect(res).toBeInstanceOf(AdvertEntity);
          expect(res.owner).toBeNull();
          expect(res.entityId).toBeNull();
          expect(res.entityType).toBeNull();
        });
      });
    });
  });

  describe('Parent', () => {
    describe('findOne', () => {
      it('Can find parent entity with children', async () => {
        const repository = AbstractPolymorphicRepository.createRepository(
          connection,
          UserRepository,
        );
        const advertRepository = AbstractPolymorphicRepository.createRepository(
          connection,
          AdvertRepository,
        );

        const user = await repository.save(new UserEntity());

        const advert = await advertRepository.save(
          advertRepository.create({
            owner: user,
          }),
        );

        let result = await repository.findOne({
          where: { id: user.id },
        });

        result = await repository.hydrateOne(result);

        expect(result).toBeInstanceOf(UserEntity);
        expect(result?.adverts).toHaveLength(1);
        expect(result?.adverts[0]).toBeInstanceOf(AdvertEntity);
        expect(result?.adverts[0].id).toBe(advert.id);
        expect(result?.adverts[0].entityType).toBe(UserEntity.name);
        expect(result?.adverts[0].entityId).toBe(user.id);
      });

      it('Can find parent entity with children with customized entity and id columns', async () => {
        const repository = AbstractPolymorphicRepository.createRepository(
          connection,
          UserRepository,
        );
        const advertRepository = AbstractPolymorphicRepository.createRepository(
          connection,
          AdvertRepository,
        );

        const user = await repository.save(new UserEntity());

        const advert = await advertRepository.save(
          advertRepository.create({
            creator: user,
          }),
        );

        let result = await repository.findOne({
          where: { id: user.id },
        });

        result = await repository.hydrateOne(result);

        expect(result).toBeInstanceOf(UserEntity);
        expect(result?.createdAdverts).toHaveLength(1);
        expect(result?.createdAdverts[0]).toBeInstanceOf(AdvertEntity);
        expect(result?.createdAdverts[0].id).toBe(advert.id);
        expect(result?.createdAdverts[0].creatorType).toBe(UserEntity.name);
        expect(result?.createdAdverts[0].creatorId).toBe(user.id);
      });
    });
  });

  describe('Batch', () => {
    describe('hydrate', () => {
      it('Can hydrate entities with polymorphic relationships properly', async () => {
        const advertRepository = AbstractPolymorphicRepository.createRepository(
          connection,
          AdvertRepository,
        );
        const userRepository = AbstractPolymorphicRepository.createRepository(
          connection,
          UserRepository,
        );
        const merchantRepository = connection.getRepository(MerchantEntity);

        const user = await userRepository.save(new UserEntity());
        const user2 = await userRepository.save(new UserEntity());
        const user3 = await userRepository.save(new UserEntity());
        const merchant = await merchantRepository.save(new MerchantEntity());
        const merchant2 = await merchantRepository.save(new MerchantEntity());

        type ManifestItem = {
          config: DeepPartial<AdvertEntity>;
          advert: AdvertEntity | null;
          user: UserEntity | null;
        };
        const manifest: Array<ManifestItem> = [
          { config: { owner: user }, advert: null, user: user },
          { config: { owner: user2 }, advert: null, user: user2 },
          { config: { owner: user3 }, advert: null, user: user3 },
          { config: { owner: merchant }, advert: null, user: null },
          { config: { owner: merchant2 }, advert: null, user: null },
          { config: { creator: merchant2 }, advert: null, user: null },
          {
            config: { owner: user, creator: merchant2 },
            advert: null,
            user: user,
          },
          {
            config: { owner: user2, creator: merchant2 },
            advert: null,
            user: user2,
          },
        ];

        // save all the items first the maximize the chance of
        // hydration errors
        for (const item of manifest) {
          const entity = await advertRepository.save(
            advertRepository.create(item.config),
          );
          item.advert = entity;
        }

        /********************************
         * test advert hydration (parent)
         ********************************/
        const adverts = await advertRepository.find();
        const advertManifestMap = manifest.reduce((acc, item) => {
          if (item.advert) {
            acc[item.advert.id] = item;
          }
          return acc;
        }, {});

        for (const advert of adverts) {
          const manifestItem = advertManifestMap[advert.id];
          if (!manifestItem) {
            throw new Error('this should not happen.');
          }

          const {
            config: { owner, creator },
          } = manifestItem;
          if (owner) {
            expect(advert.owner).toBeInstanceOf(owner.constructor);
            expect(advert.owner.id).toBe(owner.id);
          }

          if (creator) {
            expect(advert.creator).toBeInstanceOf(creator.constructor);
            expect(advert.creator.id).toBe(creator.id);
          }
        }

        /********************************
         * test user hydration (child)
         ********************************/
        const users = await userRepository.find();
        const usersAdvertMap = manifest.reduce<Record<number, AdvertEntity[]>>(
          (acc, item) => {
            if (item.user && item.advert) {
              acc[item.user.id] = acc[item.user.id] || [];
              acc[item.user.id].push(item.advert);
            }
            return acc;
          },
          {},
        );

        for (const user of users) {
          const adverts = usersAdvertMap[user.id];
          if (!adverts || !adverts.length) {
            throw new Error('this should not happen.');
          }

          const actualIds = user.adverts
            .map((advert) => {
              return advert.id;
            })
            .sort();
          const expectedIds = adverts
            .map((advert) => {
              return advert.id;
            })
            .sort();
          expect(actualIds).toEqual(expectedIds);
        }
      });
    });
  });
});

import { PolymorphicDecoratorOptionsInterface } from './polymorphic.interface';
export declare const PolymorphicChildren: (classType: () => Function[] | Function, options?: PolymorphicDecoratorOptionsInterface) => PropertyDecorator;
export declare const PolymorphicParent: (classType: () => Function[] | Function, options?: PolymorphicDecoratorOptionsInterface) => PropertyDecorator;
export declare const PolymorphicRepository: (entity: Function) => ClassDecorator;

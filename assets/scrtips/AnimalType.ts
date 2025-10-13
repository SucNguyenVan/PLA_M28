import { Enum } from "cc";

export enum AnimalType {
    Bunny = 1,
    Chicken = 2,
    Cow = 3,
    Horse = 4,
    Pig = 5,
    Sheep = 6
}

export const AnimalTypeEnumSelect = Enum(AnimalType)
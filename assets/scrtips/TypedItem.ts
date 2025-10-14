import { _decorator, Component } from "cc";
import { AnimalType } from "./AnimalType";
const { ccclass, property } = _decorator;

/** 5 loại type */
export enum ItemType {
  Type1 = 1,
  Type2 = 2,
  Type3 = 3,
  Type4 = 4,
  Type5 = 5,
}

/** Component giữ type cho node được spawn */
@ccclass("TypedItem")
export class TypedItem extends Component {
  @property({ tooltip: "Kiểu type của item này" })
  itemType: AnimalType = AnimalType.Bunny;
}

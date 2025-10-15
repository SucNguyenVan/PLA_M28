import { _decorator, Component } from "cc";
import { AnimalType } from "./AnimalType";
const { ccclass, property } = _decorator;

/** Component giữ type cho node được spawn */
@ccclass("TypedItem")
export class TypedItem extends Component {
  @property({ tooltip: "Kiểu type của item này" })
  itemType: AnimalType = AnimalType.Bunny;
}

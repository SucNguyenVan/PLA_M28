import { _decorator, Component, Node, sp } from "cc";
import { moveNodeAToB } from "./NodeMover";
import { Dir } from "./Dir";
import { distanceWorldXY } from "./Distance";
import { SlotSpawnManager } from "./SlotSpawnManager";
import { AnimalType } from "./AnimalType";
import { AnimalMoverOutSimpleAnim } from "./AnimalMoverSimple";
const { ccclass, property } = _decorator;

enum StartMoveVector {
  TopLeft = 1,
  TopRight = 2,
  BottomLeft = 3,
  BottomRight = 4,
}

@ccclass("AnimalsController")
export class AnimalsController extends Component {
  @property({ type: Node })
  concertPoint1: Node;
  @property({ type: Node })
  concertPoint2: Node;
  @property({ type: Node })
  concertPoint3: Node;
  @property({ type: Node })
  concertPoint4: Node;
  @property({ type: Node })
  wayToBarPoint: Node;
  @property({ type: Node })
  barPoint: Node;

  animalVectorStore: Record<string, StartMoveVector> = {};

  onEnable() {
    this.node.children.forEach((childNode) => {
      childNode?.on("hit-left-wall", () => this.moveFromLeft(childNode), this);
      childNode?.on(
        "hit-right-wall",
        () => this.moveFromRight(childNode),
        this
      );
      childNode?.on("hit-top-wall", () => this.moveFromTop(childNode), this);
      childNode?.on(
        "hit-bottom-wall",
        () => this.moveFromBottom(childNode),
        this
      );
      childNode?.on("start-move-top", (animalNode: Node, facing: Dir) => {
        console.log({ animalNode, facing });
        if (
          distanceWorldXY(animalNode, this.concertPoint1) <=
          distanceWorldXY(animalNode, this.concertPoint2)
        ) {
          this.animalVectorStore[animalNode.name] = StartMoveVector.TopLeft;
        } else {
          this.animalVectorStore[animalNode.name] = StartMoveVector.TopRight;
        }
      });
      childNode?.on("start-move-bottom", (animalNode: Node, facing: Dir) => {
        console.log({ animalNode, facing });
        if (
          distanceWorldXY(animalNode, this.concertPoint3) <=
          distanceWorldXY(animalNode, this.concertPoint4)
        ) {
          this.animalVectorStore[animalNode.name] = StartMoveVector.BottomRight;
        } else {
          this.animalVectorStore[animalNode.name] = StartMoveVector.BottomLeft;
        }
      });
    });
  }
  onDisable() {
    this.node.children.forEach((childNode) => {
      childNode?.off("hit-left-wall", this.moveFromLeft, this);
      childNode?.off("hit-right-wall", this.moveFromRight, this);
    });
  }
  private playSpineSafe(comp: sp.Skeleton, name: string, loop = true) {
    const tryPlay = () => {
      const s: any = (comp as any)._skeleton;
      if (!s || !s.data) {
        this.scheduleOnce(tryPlay, 0); // đợi frame kế nếu chưa ready
        return;
      }
      const anim = s.data.findAnimation(name.trim());
      if (!anim) {
        const names = s.data.animations.map((a: any) => a.name);
        console.warn(
          `[Spine] Animation not found: "${name}". Available:`,
          names
        );
        return;
      }
      comp.clearTrack(0);
      comp.setAnimation(0, name, loop);
    };
    tryPlay();
  }
  setAnimalAnimation(animalNode: Node, animationName: string, loop = true) {
    const skel = animalNode.getComponent(sp.Skeleton);
    if (skel) {
      skel.clearTracks();
      skel.setToSetupPose();
      (skel as any).invalidAnimationCache?.();
      this.playSpineSafe(skel, animationName, loop);
    }
  }
  async moveFromLeft(childNode: Node) {
    console.log("[Parent] nhận ping trực tiếp từ con:", childNode);
    this.setAnimalAnimation(childNode, "f_move", true);
    await moveNodeAToB(childNode, this.concertPoint4);
    this.setAnimalAnimation(childNode, "r_move", true);
    await moveNodeAToB(childNode, this.wayToBarPoint);
    await this.goToBar(childNode);
  }

  async moveFromRight(childNode: Node) {
    console.log("[Parent] nhận ping trực tiếp từ con:", childNode);
    this.setAnimalAnimation(childNode, "f_move", true);
    await moveNodeAToB(childNode, this.concertPoint3);
    this.setAnimalAnimation(childNode, "l_move", true);
    await moveNodeAToB(childNode, this.wayToBarPoint);
    await this.goToBar(childNode);
  }

  async moveFromTop(childNode: Node) {
    console.log("animalVectorStore", this.animalVectorStore);
    if (this.animalVectorStore[childNode.name] === StartMoveVector.TopLeft) {
      this.setAnimalAnimation(childNode, "l_move", true);
      await moveNodeAToB(childNode, this.concertPoint1);
      await this.moveFromLeft(childNode);
    }else if(this.animalVectorStore[childNode.name] === StartMoveVector.TopRight){
      this.setAnimalAnimation(childNode, "r_move", true);
      await moveNodeAToB(childNode, this.concertPoint2);
      await this.moveFromRight(childNode);
    }
  }

  async moveFromBottom(childNode: Node) {
    console.log(this.animalVectorStore[childNode.name])
    if (
      this.animalVectorStore[childNode.name] === StartMoveVector.BottomRight
    ) {
      this.setAnimalAnimation(childNode, "l_move", true);
    } else {
      this.setAnimalAnimation(childNode, "r_move", true);
    }
    await moveNodeAToB(childNode, this.wayToBarPoint);
    await this.goToBar(childNode);
  }

  async goToBar(animalNode: Node) {
    this.setAnimalAnimation(animalNode, "f_move", true);
    await moveNodeAToB(animalNode, this.barPoint);
    const slotSpawnManagerScript = this.barPoint.getComponent(SlotSpawnManager);
    if (slotSpawnManagerScript) {
      const animalMoverOutSimpleAnimScript = animalNode.getComponent(
        AnimalMoverOutSimpleAnim
      );
      if (animalMoverOutSimpleAnimScript) {
        slotSpawnManagerScript.triggerSpawn(
          animalMoverOutSimpleAnimScript.animalType
        );
        animalNode.active = false
      }
    }
  }
}

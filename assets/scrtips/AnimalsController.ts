import { _decorator, Component, Node, sp } from "cc";
import { moveNodeAToB } from "./NodeMover";
const { ccclass, property } = _decorator;

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

  onEnable() {
    this.node.children.forEach((childNode) => {
      childNode?.on("hit-left-wall", () => this.moveFromLeft(childNode), this);
      childNode?.on("hit-right-wall", () => this.moveFromRight(childNode), this);
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
    this.setAnimalAnimation(childNode, "f_move", true);
    await moveNodeAToB(childNode, this.barPoint);
  }

    async moveFromRight(childNode: Node) {
    console.log("[Parent] nhận ping trực tiếp từ con:", childNode);
    this.setAnimalAnimation(childNode, "f_move", true);
    await moveNodeAToB(childNode, this.concertPoint3);
    this.setAnimalAnimation(childNode, "l_move", true);
    await moveNodeAToB(childNode, this.wayToBarPoint);
    this.setAnimalAnimation(childNode, "f_move", true);
    await moveNodeAToB(childNode, this.barPoint);
  }
}

// assets/scripts/SlotSpawnManager.ts
import {
  _decorator,
  Component,
  Node,
  instantiate,
  v3,
  tween,
  UIOpacity,
  sp,
} from "cc";
import { TypedItem } from "./TypedItem";
import { AnimalType } from "./AnimalType";
const { ccclass, property } = _decorator;

type SlotEntry = {
  node: Node;
  type: AnimalType;
};

@ccclass("SlotSpawnManager")
export class SlotSpawnManager extends Component {
  @property({ type: Node, tooltip: "Node mẫu (luôn ẩn) để instantiate" })
  baseNode: Node | null = null;

  @property({ type: [Node], tooltip: "6 slot theo thứ tự trái→phải" })
  slots: Node[] = [];

  @property({ tooltip: "Khoảng dịch phải tạm thời khi có trùng (px, local-space)" })
  shiftDistance: number = 100;

  @property({ tooltip: "Thời gian dịch sang phải (giây)" })
  shiftDuration: number = 0.15;

  @property({ tooltip: "Thời gian animation xóa (giây) (fade/scale)" })
  popDuration: number = 0.25;

  @property({ tooltip: "Thời gian giữ animation merge trước khi lấp slot (ms)" })
  mergeHoldMs: number = 600;

  /** Danh sách các node đã điền (theo thứ tự slot 1..n) */
  private _filled: SlotEntry[] = [];

  appearAnimStore = new Map<AnimalType, string>();
  mergeAnimStore = new Map<AnimalType, string>();

  onLoad() {
    this.appearAnimStore.set(AnimalType.Bunny, "bunny_appear");
    this.appearAnimStore.set(AnimalType.Chicken, "chicken_appear");
    this.appearAnimStore.set(AnimalType.Cow, "cow_appear");
    this.appearAnimStore.set(AnimalType.Horse, "horse_appear");
    this.appearAnimStore.set(AnimalType.Pig, "pig_appear");
    this.appearAnimStore.set(AnimalType.Sheep, "sheep_appear");

    this.mergeAnimStore.set(AnimalType.Bunny, "bunny_match");
    this.mergeAnimStore.set(AnimalType.Chicken, "chicken_match");
    this.mergeAnimStore.set(AnimalType.Cow, "cow_match");
    this.mergeAnimStore.set(AnimalType.Horse, "horse_match");
    this.mergeAnimStore.set(AnimalType.Pig, "pig_match");
    this.mergeAnimStore.set(AnimalType.Sheep, "sheep_match");

    if (this.baseNode) this.baseNode.active = false;
    if (this.slots.length !== 6) {
      console.warn("[SlotSpawnManager] Nên kéo đúng 6 slot. Hiện có:", this.slots.length);
    }
  }

  /** Gọi để spawn 1 item với type cho trước */
  public async triggerSpawn(type: AnimalType) {
    if (!this.baseNode) {
      console.error("[SlotSpawnManager] Chưa gán baseNode!");
      return;
    }

    // Tạo node mới từ baseNode (chưa điền vào slot)
    const newNode = instantiate(this.baseNode);
    newNode.setParent(this.node);
    newNode.setPosition(0, 0, 0);

    // set type
    const ti = newNode.getComponent(TypedItem) ?? newNode.addComponent(TypedItem);
    ti.itemType = type;

    // Kiểm tra trùng type
    const dupIndex = this._filled.findIndex((e) => e.type === type);

    if (dupIndex === -1) {
      // Không trùng → điền vào slot kế
      newNode.active = true;
      if (this._filled.length >= this.slots.length) {
        console.warn("[SlotSpawnManager] Hết slot. Node mới sẽ bị hủy.");
        newNode.destroy();
        return;
      }
      const targetSlot = this.slots[this._filled.length];
      newNode.setScale(0.8, 0.8);
      newNode.setParent(targetSlot);
      newNode.setPosition(0, 0, 0);
      this.setSkeleton(newNode, type);
      this._filled.push({ node: newNode, type });
      return;
    }

    // ======= CÓ TRÙNG =======
    // Các node phía sau dupIndex cần dịch sang phải (để chờ merge anim ở dupIndex)
    const needShift = this._filled.slice(dupIndex + 1).map((e) => e.node);
    const dupNode = this._filled[dupIndex].node;

    // (1) Bắt đầu dịch các node sau sang phải
    const shiftP = this._shiftRight(needShift, this.shiftDistance, this.shiftDuration);

    // (2) NGAY LÚC NÀY: cho dupNode chơi animation merge
    const mergeAnimName = this.mergeAnimStore.get(type);
    if (mergeAnimName) {
      this.setAnimalAnimation(dupNode, mergeAnimName, true);
    }

    // (3) Chờ cho: a) dịch phải xong, b) giữ merge 1 khoảng thời gian
    await Promise.all([shiftP, this.delay(this.mergeHoldMs)]);

    // (4) pop nhẹ rồi xóa dupNode
    await this._fadeAndDestroy(dupNode, this.popDuration);

    // (5) Xóa bản ghi slot dupIndex
    this._filled.splice(dupIndex, 1);

    // (6) Kéo các node còn lại lấp về trước (3→2, 4→3, …)
    for (let i = dupIndex; i < this._filled.length; i++) {
      const entry = this._filled[i];
      const targetSlot = this.slots[i];
      entry.node.setParent(targetSlot);
      await this._tweenToLocalZero(entry.node, this.shiftDuration * 0.8);
    }

    // Node spawn mới không dùng nữa (theo mô tả)
    newNode.destroy();
  }

  // ---------------- Spine helpers ----------------

  setSkeleton(iconNode: Node, type: AnimalType) {
    this.setAnimalAnimation(iconNode, this.appearAnimStore.get(type), false);
  }

  setAnimalAnimation(animalNode: Node, animationName?: string | null, loop = true) {
    if (!animationName) return;
    const skel = animalNode.getComponent(sp.Skeleton);
    if (skel) {
      skel.clearTracks();
      skel.setToSetupPose();
      (skel as any).invalidAnimationCache?.();
      this.playSpineSafe(skel, animationName, loop);
    }
  }

  private playSpineSafe(comp: sp.Skeleton, name: string, loop = true) {
    const tryPlay = () => {
      const s: any = (comp as any)._skeleton;
      if (!s || !s.data) {
        this.scheduleOnce(tryPlay, 0);
        return;
      }
      const anim = s.data.findAnimation(name.trim());
      if (!anim) {
        const names = s.data.animations.map((a: any) => a.name);
        console.warn(`[Spine] Animation not found: "${name}". Available:`, names);
        return;
      }
      comp.clearTrack(0);
      comp.setAnimation(0, name, loop);
    };
    tryPlay();
  }

  // ---------------- tween helpers ----------------

  /** Dịch các node sang phải một đoạn (local X += distance) */
  private _shiftRight(nodes: Node[], distance: number, dur: number): Promise<void> {
    if (nodes.length === 0) return Promise.resolve();
    const tasks = nodes.map((n) => {
      const p = n.position.clone();
      const target = v3(p.x + distance, p.y, p.z);
      return new Promise<void>((resolve) => {
        tween(n).to(dur, { position: target }).call(() => resolve()).start();
      });
    });
    return Promise.all(tasks).then(() => void 0);
  }

  /** Tween node về local (0,0,0) */
  private _tweenToLocalZero(n: Node, dur: number): Promise<void> {
    return new Promise<void>((resolve) => {
      tween(n).to(dur, { position: v3(0, 0, 0) }).call(() => resolve()).start();
    });
  }

  /** Fade + scale nhẹ rồi destroy (KHÔNG chạy song song tween khác target để tránh lỗi type) */
  private async _fadeAndDestroy(n: Node, dur: number): Promise<void> {
    const opacity = n.getComponent(UIOpacity) ?? n.addComponent(UIOpacity);
    opacity.opacity = 255;

    const scaleFrom = n.scale.clone();
    const scaleUp = v3(scaleFrom.x * 1.2, scaleFrom.y * 1.2, scaleFrom.z);

    // scale up nhanh
    await new Promise<void>((resolve) => {
      tween(n).to(dur * 0.4, { scale: scaleUp }).call(() => resolve()).start();
    });

    // fade out + scale back (chạy song song bằng Promise.all)
    const fadeP = new Promise<void>((resolve) => {
      tween(opacity).to(dur * 0.6, { opacity: 0 }).call(() => resolve()).start();
    });
    const scaleBackP = new Promise<void>((resolve) => {
      tween(n).to(dur * 0.6, { scale: scaleFrom }).call(() => resolve()).start();
    });

    await Promise.all([fadeP, scaleBackP]);
    n.destroy();
  }

  // ---------------- tiện ích ----------------

  delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  public clearAll() {
    for (const e of this._filled) if (e.node?.isValid) e.node.destroy();
    this._filled.length = 0;
  }

  public get filledCount(): number {
    return this._filled.length;
  }
}

// assets/scripts/NodeMover.ts
import {
  _decorator,
  Component,
  Node,
  Vec3,
  v3,
  RigidBody2D,
  Vec2,
  v2,
} from "cc";
const { ccclass } = _decorator;

/**
 * Di chuyển nodeA tới nodeB (ưu tiên bằng RigidBody2D để bắt va chạm).
 * @param nodeA Node sẽ di chuyển
 * @param nodeB Node đích
 * @param speed tốc độ (đơn vị/giây)
 * @param stopDistance khoảng cách coi như đã tới đích
 * @param follow true: luôn bám theo vị trí hiện tại của nodeB
 */
export function moveNodeAToB(
  nodeA: Node,
  nodeB: Node,
  speed: number = 5,
  stopDistance: number = 40,
  follow: boolean = false
): Promise<void> {
  const mover =
    nodeA.getComponent(__HiddenNodeMover) ||
    nodeA.addComponent(__HiddenNodeMover);
  return mover._run(nodeB, speed, stopDistance, follow);
}

/** TẠM DỪNG / TIẾP TỤC di chuyển (không đổi hành vi cũ) */
export function pauseNodeMove(nodeA: Node) {
  const m = nodeA.getComponent(__HiddenNodeMover);
  m?._pause();
}
export function resumeNodeMove(nodeA: Node) {
  const m = nodeA.getComponent(__HiddenNodeMover);
  m?._resume();
}
export function isNodeMovePaused(nodeA: Node): boolean {
  const m = nodeA.getComponent(__HiddenNodeMover);
  return !!m?._isPaused();
}

/** Component ẩn, chỉ dùng nội bộ cho moveNodeAToB() */
@ccclass("__HiddenNodeMover")
class __HiddenNodeMover extends Component {
  private _target: Node | null = null;
  private _speed = 5;
  private _stop = 2;
  private _follow = false;

  private _resolve: (() => void) | null = null;
  private _reject: ((r?: any) => void) | null = null;

  private _tmpA: Vec3 = v3();
  private _tmpB: Vec3 = v3();   // world target
  private _dir: Vec3 = v3();

  private _paused = false;
  private _rb: RigidBody2D | null = null;
  private _usePhysics = false;
  private _fixedTargetSet = false; // đã chụp đích 1 lần khi follow=false

  /** Khởi chạy (có job cũ thì hủy) */
  public _run(
    target: Node,
    speed: number,
    stopDistance: number,
    follow: boolean
  ): Promise<void> {
    this._cancel("restarted");
    this._target = target;
    this._speed = speed;
    this._stop = stopDistance;
    this._follow = follow;
    this._paused = false;
    this._fixedTargetSet = false;
    this._tmpB.set(0, 0, 0);

    this._rb = this.node.getComponent(RigidBody2D);
    this._usePhysics = !!this._rb; // có RB2D thì dùng velocity để di chuyển

    return new Promise<void>((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
      this.enabled = true; // bật update
    });
  }

  // --- Pause/Resume ---
  public _pause() {
    this._paused = true;
    if (this._usePhysics && this._rb) {
      this._rb.linearVelocity = v2(0, 0) as unknown as Vec2;
      if (!this._rb.isAwake()) this._rb.wakeUp();
    }
  }
  public _resume() {
    this._paused = false;
    if (this._usePhysics && this._rb && !this._rb.isAwake()) this._rb.wakeUp();
  }
  public _isPaused() { return this._paused; }

  /** Hủy job (reject) */
  private _cancel(reason = "stopped") {
    if (this._reject) this._reject(reason);
    this._clear();
  }

  /** Hoàn thành (resolve) */
  private _done() {
    if (this._resolve) this._resolve();
    this._clear();
    // Giữ hành vi cũ: tự hủy component
    this.destroy();
  }

  private _clear() {
    if (this._usePhysics && this._rb) {
      this._rb.linearVelocity = v2(0, 0) as unknown as Vec2;
    }
    this._target = null;
    this._resolve = null;
    this._reject = null;
    this.enabled = false;
    this._paused = false;
    this._fixedTargetSet = false;
  }

  onDisable() {
    // GIỮ NGUYÊN hành vi cũ: reject nếu đang chạy mà bị disable
    if (this._reject) this._cancel("disabled");
  }

  update(dt: number) {
    const a = this.node;
    const b = this._target;

    if (!b || !b.isValid) { this._cancel("target destroyed"); return; }
    if (!a || !a.isValid) { this._cancel("nodeA destroyed"); return; }

    // vị trí hiện tại & đích
    this._tmpA.set(a.worldPosition);

    if (this._follow) {
      this._tmpB.set(b.worldPosition);
    } else if (!this._fixedTargetSet) {
      this._tmpB.set(b.worldPosition);
      this._fixedTargetSet = true;
    }

    // vector tới đích
    this._dir.set(this._tmpB).subtract(this._tmpA);
    const dist = this._dir.length();

    // tới nơi?
    if (dist <= this._stop) {
      a.setWorldPosition(this._tmpB);
      if (this._usePhysics && this._rb) {
        this._rb.linearVelocity = v2(0, 0) as unknown as Vec2;
      }
      this._done();
      return;
    }

    if (this._paused) {
      if (this._usePhysics && this._rb) {
        this._rb.linearVelocity = v2(0, 0) as unknown as Vec2;
        if (!this._rb.isAwake()) this._rb.wakeUp();
      }
      return;
    }

    if (dist > 1e-6) {
      this._dir.multiplyScalar(1 / dist); // normalize

      if (this._usePhysics && this._rb) {
        // === DI CHUYỂN BẰNG PHYSICS (để nhận va chạm) ===
        const stepV = v2(this._dir.x * this._speed, this._dir.y * this._speed);
        this._rb.linearVelocity = stepV as unknown as Vec2;
        if (!this._rb.isAwake()) this._rb.wakeUp();
      } else {
        // === FALLBACK: transform ===
        const step = this._speed * dt;
        if (step >= dist) {
          a.setWorldPosition(this._tmpB);
        } else {
          const next = v3(
            this._tmpA.x + this._dir.x * step,
            this._tmpA.y + this._dir.y * step,
            this._tmpA.z + this._dir.z * step
          );
          a.setWorldPosition(next);
        }
      }
    }
  }
}

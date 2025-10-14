// assets/scripts/NodeMover.ts
import {
  _decorator,
  Component,
  Node,
  Vec3,
  v3,
} from "cc";
const { ccclass } = _decorator;

/**
 * HÀM CÔNG KHAI:
 * Di chuyển nodeA tới nodeB bằng world-space.
 * @param nodeA Node sẽ di chuyển
 * @param nodeB Node đích
 * @param speed tốc độ (đơn vị/giây)
 * @param stopDistance khoảng cách coi như đã tới đích
 * @param follow nếu true: bám theo vị trí hiện tại của nodeB trong suốt quá trình (khi B cũng di chuyển)
 * @returns Promise resolve khi tới nơi; reject nếu bị hủy/target destroy.
 */
export function moveNodeAToB(
  nodeA: Node,
  nodeB: Node,
  speed: number = 150,
  stopDistance: number = 40,
  follow: boolean = false
): Promise<void> {
  // Đảm bảo có component chạy update để di chuyển
  const mover =
    nodeA.getComponent(__HiddenNodeMover) ||
    nodeA.addComponent(__HiddenNodeMover);
  return mover._run(nodeB, speed, stopDistance, follow);
}

/**
 * Component ẩn, chỉ dùng nội bộ cho hàm moveNodeAToB()
 */
@ccclass("__HiddenNodeMover")
class __HiddenNodeMover extends Component {
  private _target: Node | null = null;
  private _speed = 300;
  private _stop = 2;
  private _follow = false;

  private _resolve: (() => void) | null = null;
  private _reject: ((r?: any) => void) | null = null;

  private _tmpA: Vec3 = v3();
  private _tmpB: Vec3 = v3();

  /** Khởi chạy một lần; có job đang chạy sẽ bị hủy. */
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

    return new Promise<void>((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
      this.enabled = true; // bật update
    });
  }

  /** Hủy job đang chạy (nếu có) */
  private _cancel(reason = "stopped") {
    if (this._reject) this._reject(reason);
    this._clear();
  }

  private _done() {
    if (this._resolve) this._resolve();
    this._clear();
    // Tự huỷ để không để lại rác
    // (Nếu bạn muốn giữ lại component cho lần sau, có thể bỏ dòng destroy())
    this.destroy();
  }

  private _clear() {
    this._target = null;
    this._resolve = null;
    this._reject = null;
    this.enabled = false;
  }

  onDisable() {
    // Nếu bị disable bất ngờ khi đang có Promise -> coi như hủy
    if (this._reject) this._cancel("disabled");
  }

  update(dt: number) {
    const a = this.node;
    const b = this._target;

    if (!b || !b.isValid) {
      this._cancel("target destroyed");
      return;
    }
    if (!a || !a.isValid) {
      this._cancel("nodeA destroyed");
      return;
    }

    // Lấy world pos hiện tại của A
    this._tmpA.set(a.worldPosition);
    // Lấy world pos mục tiêu (nếu follow=true sẽ luôn cập nhật theo vị trí mới của B)
    this._tmpB.set(b.worldPosition);

    // Tính hướng & khoảng cách
    const dir = this._tmpB.subtract(this._tmpA);
    const dist = dir.length();

    // Đã tới nơi?
    if (dist <= this._stop) {
      // Đặt chốt vị trí cho sạch (snap)
      a.setWorldPosition(b.worldPosition);
      this._done();
      return;
    }

    // Di chuyển một bước
    if (dist > 1e-6) {
      dir.normalize();
      const step = this._speed * dt;
      if (step >= dist) {
        a.setWorldPosition(this._tmpB);
      } else {
        const next = v3(
          this._tmpA.x + dir.x * step,
          this._tmpA.y + dir.y * step,
          this._tmpA.z + dir.z * step
        );
        a.setWorldPosition(next);
      }
    }
  }
}

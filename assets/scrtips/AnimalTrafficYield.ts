// assets/scripts/AnimalTrafficYield.ts
// Cocos Creator 3.x
import {
  _decorator,
  Component,
  Collider2D,
  Contact2DType,
  IPhysics2DContact,
  Node,
  RigidBody2D,
  ERigidBody2DType,
} from "cc";
import { pauseNodeMove, resumeNodeMove } from "./NodeMover";
const { ccclass, property } = _decorator;

/**
 * NHƯỜNG ĐƯỜNG BẰNG VẬT LÝ (đổi body type ở frame kế tiếp để tránh lỗi Box2D):
 * - BEGIN_CONTACT: chọn 1 con "nhường" → PAUSE + đổi type sang STATIC (queued).
 * - END_CONTACT: khi không còn chạm ai → đổi về KINEMATIC (queued) + RESUME.
 *
 * YÊU CẦU: RigidBody2D(type=Kinematic, gravityScale=0, fixedRotation=true), BoxCollider2D(isSensor=false).
 */
@ccclass("AnimalTrafficYield")
export class AnimalTrafficYield extends Component {
  @property({ tooltip: "Bật log debug" })
  debug = false;

  /** Nếu bật → luôn nhường (dùng test) */
  @property({ tooltip: "Luôn nhường (dùng cho testing)" })
  alwaysYield = false;

  private _col: Collider2D | null = null;
  private _rb: RigidBody2D | null = null;

  /** Tập node đang tiếp xúc với mình */
  private _contacts = new Set<Node>();
  /** Mình đang là kẻ nhường không? */
  private _isYielding = false;

  // ---- đổi body type an toàn (queued ra frame sau) ----
  private _pendingType: ERigidBody2DType | null = null;
  private _typeChangeQueued = false;

  onEnable() {
    this._col = this.getComponent(Collider2D);
    this._rb  = this.getComponent(RigidBody2D);

    if (!this._col) {
      console.warn("[AnimalTrafficYield] Thiếu Collider2D:", this.node.name);
      return;
    }
    if (!this._rb) {
      console.warn("[AnimalTrafficYield] Thiếu RigidBody2D:", this.node.name);
    }

    this._col.on(Contact2DType.BEGIN_CONTACT, this.onBegin, this);
    this._col.on(Contact2DType.END_CONTACT, this.onEnd, this);
  }

  onDisable() {
    if (this._col) {
      this._col.off(Contact2DType.BEGIN_CONTACT, this.onBegin, this);
      this._col.off(Contact2DType.END_CONTACT, this.onEnd, this);
    }
    // Trả lại bình thường nếu đang yield
    if (this._isYielding) this._beKinematicAndResume();
    this._contacts.clear();
    this._pendingType = null;
    this._typeChangeQueued = false;
  }

  private onBegin(self: Collider2D, other: Collider2D, _c: IPhysics2DContact | null) {
    const otherNode = other?.node;
    if (!otherNode || !this._rb) return;

    // Chỉ xử lý nếu node kia cũng là animal có script này
    const otherYield = otherNode.getComponent(AnimalTrafficYield);
    if (!otherYield) return;

    this._contacts.add(otherNode);

    // Luật nhường: ưu tiên alwaysYield; nếu không thì uuid lớn hơn nhường (ổn định)
    let iShouldYield = this.alwaysYield || this.node.uuid > otherNode.uuid;

    if (iShouldYield) {
      this._beStaticAndPause();
      if (this.debug) console.log("[Yield] PAUSE+STATIC (queued)", this.node.name, "↔", otherNode.name);
    } else {
      // mình được đi; nếu lỡ đang ở trạng thái yield thì trả lại bình thường
      if (this._isYielding) {
        this._beKinematicAndResume();
        if (this.debug) console.log("[Yield] I GO (resume)", this.node.name);
      }
    }
  }

  private onEnd(self: Collider2D, other: Collider2D, _c: IPhysics2DContact | null) {
    const otherNode = other?.node;
    if (!otherNode || !this._rb) return;

    this._contacts.delete(otherNode);

    // Khi KHÔNG còn chạm ai nữa → nếu đang yield thì trả lại bình thường
    if (this._contacts.size === 0 && this._isYielding) {
      this._beKinematicAndResume();
      if (this.debug) console.log("[Yield] RESUME+KINEMATIC (queued)", this.node.name);
    }
  }

  // ---- helpers ----
  private _beStaticAndPause() {
    if (!this._rb) return;
    this._queueBodyType(ERigidBody2DType.Static); // đổi type ở frame sau
    pauseNodeMove(this.node);                      // dừng NodeMover ngay
    this._isYielding = true;
  }

  private _beKinematicAndResume() {
    if (!this._rb) return;
    this._queueBodyType(ERigidBody2DType.Kinematic); // đổi type ở frame sau
    resumeNodeMove(this.node);                        // tiếp tục đi
    this._isYielding = false;
  }

  /** Đổi body type an toàn sau bước vật lý hiện tại */
  private _queueBodyType(t: ERigidBody2DType) {
    if (!this._rb) return;
    // Nếu đã đúng type thì thôi
    if (this._rb.type === t) return;

    this._pendingType = t;
    if (this._typeChangeQueued) return;

    this._typeChangeQueued = true;
    // Lịch frame sau (sau khi physics step hiện tại kết thúc)
    this.scheduleOnce(() => {
      if (this._rb && this._pendingType !== null) {
        this._rb.type = this._pendingType; // <-- an toàn, không còn trong callback
      }
      this._pendingType = null;
      this._typeChangeQueued = false;
    }, 0);
  }
}

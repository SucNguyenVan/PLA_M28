// Cocos Creator 3.x
import {
  _decorator,
  Component,
  Node,
  Collider2D,
  Contact2DType,
  IPhysics2DContact,
  RigidBody2D,
} from 'cc';
const { ccclass, property } = _decorator;

/**
 * AnimalWallSensor
 * - Lắng nghe va chạm giữa Animal và 4 tường: TopWall / RightWall / BottomWall / LeftWall.
 * - Khi CHẠM lần đầu:
 *    + Emit: 'hit-wall' (payload: 'Top'|'Right'|'Bottom'|'Left')
 *    + Emit thêm: 'hit-top-wall' | 'hit-right-wall' | 'hit-bottom-wall' | 'hit-left-wall'
 *    + Ngay lập tức HUỶ lắng nghe va chạm (không bắn thêm lần 2).
 *    + (tuỳ chọn) Dừng tween, vô hiệu hoá collider, hoặc tự huỷ component.
 *
 * YÊU CẦU:
 *  - Animal: RigidBody2D (Kinematic/Dynamic, gravityScale=0), BoxCollider2D (isSensor=false).
 *  - Mỗi Wall: RigidBody2D (Static), BoxCollider2D (isSensor=true), tên node là "TopWall", "RightWall", "BottomWall", "LeftWall".
 */
@ccclass('AnimalWallSensor')
export class AnimalWallSensor extends Component {
  @property({ tooltip: 'Dừng chuyển động (tween) khi chạm' })
  stopOnHit: boolean = true;

  @property({ tooltip: 'Sau khi chạm, vô hiệu hoá Collider của animal để chắc chắn không còn callback' })
  disableColliderAfterHit: boolean = true;

  @property({ tooltip: 'Sau khi chạm, tự hủy component này (sau khi đã hủy listener)' })
  destroyComponentAfterHit: boolean = false;

  @property({ tooltip: 'Thời gian chống lặp (giây) nếu bạn KHÔNG muốn huỷ listener ngay (mặc định huỷ ngay nên không dùng)' })
  hitCooldownSec: number = 0.0;

  @property({type: Node})

  private _col: Collider2D | null = null;
  private _hitOnce = false;

  onEnable() {
    this._col = this.node.getComponent(Collider2D);
    if (!this._col) {
      console.warn('[AnimalWallSensor] Missing Collider2D on animal. Add BoxCollider2D.');
      return;
    }
    // đảm bảo có rigidbody để nhận callback va chạm
    if (!this.node.getComponent(RigidBody2D)) {
      console.warn('[AnimalWallSensor] Missing RigidBody2D on animal. Add RigidBody2D (Kinematic/Dynamic, gravityScale=0).');
    }
    this._col.on(Contact2DType.BEGIN_CONTACT, this.onBeginContact, this);
  }

  onDisable() {
    this.detachListener();
  }

  private detachListener() {
    if (this._col) {
      this._col.off(Contact2DType.BEGIN_CONTACT, this.onBeginContact, this);
    }
  }

  private onBeginContact(self: Collider2D, other: Collider2D, _contact: IPhysics2DContact | null) {
    if (this._hitOnce) return;

    const name = (other?.node?.name || '').toLowerCase();
    let which: 'Top' | 'Right' | 'Bottom' | 'Left' | null = null;

    if (name.includes('topwall')) which = 'Top';
    else if (name.includes('rightwall')) which = 'Right';
    else if (name.includes('bottomwall')) which = 'Bottom';
    else if (name.includes('leftwall')) which = 'Left';
    if (!which) return;

    this._hitOnce = true;

    // Dừng tween hiện tại (nếu có)
    if (this.stopOnHit) {
      try {
        // CC 3.x tween engine: dùng Tween.stopAllByTarget nếu sẵn có
        (cc as any)?.Tween?.stopAllByTarget?.(this.node);
      } catch {}
      try {
        // Một số dự án có shim stopAllActions
        (this.node as any).stopAllActions?.();
      } catch {}
    }

    // Phát sự kiện
    this.node.emit('hit-wall', which);
    switch (which) {
      case 'Top':    this.node.emit('hit-top-wall'); break;
      case 'Right':  this.node.emit('hit-right-wall'); break;
      case 'Bottom': this.node.emit('hit-bottom-wall'); break;
      case 'Left':   this.node.emit('hit-left-wall'); break;
    }

    // HUỶ lắng nghe ngay lập tức để không còn callback lần 2
    this.detachListener();

    // (tuỳ chọn) vô hiệu hoá collider để chặn mọi va chạm tiếp theo
    if (this.disableColliderAfterHit && this._col) {
      this._col.enabled = false;
    }

    // (tuỳ chọn) cooldown (không cần khi đã huỷ listener, nhưng giữ cho ai muốn bật)
    if (this.hitCooldownSec > 0) {
      this.scheduleOnce(() => { /* no-op; giữ để tương thích */ }, this.hitCooldownSec);
    }

    // (tuỳ chọn) tự hủy component cho gọn
    if (this.destroyComponentAfterHit) {
      this.scheduleOnce(() => { this.destroy(); }, 0);
    }
  }
}

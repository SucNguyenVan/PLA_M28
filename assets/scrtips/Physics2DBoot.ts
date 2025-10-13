// assets/scripts/Physics2DBoot.ts
import { _decorator, Component, PhysicsSystem2D, EPhysics2DDrawFlags } from 'cc';
const { ccclass } = _decorator;
@ccclass('Physics2DBoot')
export class Physics2DBoot extends Component {
  onLoad() {
    PhysicsSystem2D.instance.enable = true;
    // Bật debug shape nếu cần xem có chạm không:
    PhysicsSystem2D.instance.debugDrawFlags = EPhysics2DDrawFlags.All;
  }
}

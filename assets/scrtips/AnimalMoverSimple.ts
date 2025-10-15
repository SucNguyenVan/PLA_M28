// Cocos Creator 3.x
import {
  _decorator,
  Component,
  Node,
  Input,
  tween,
  Vec3,
  Enum,
  UITransform,
  sp,
} from "cc";
import { AnimalType, AnimalTypeEnumSelect } from "./AnimalType";
const { ccclass, property } = _decorator;

/** Hướng theo NGƯỜI NHÌN: 0 Up, 1 Right, 2 Down, 3 Left */
enum Dir {
  Up = 0,
  Right = 1,
  Down = 2,
  Left = 3,
}

type RC = { r: number; c: number };
type Probe = { canGo: boolean; endR: number; endC: number; hitEdge: boolean };

@ccclass("AnimalMoverOutSimpleAnim")
export class AnimalMoverOutSimpleAnim extends Component {
  @property({ type: AnimalTypeEnumSelect, tooltip: "loại thức ăn" })
  animalType: AnimalType;

  // ---- Cấu hình hướng & board ----
  @property({
    type: Enum(Dir),
    tooltip:
      "Hướng đã đánh dấu của con vật (0 Up, 1 Right, 2 Down, 3 Left) — theo người nhìn",
  })
  facing: Dir = Dir.Right;

  @property({
    type: Node,
    tooltip: 'Node có gắn Board.ts (@ccclass = "Board")',
  })
  boardNode: Node | null = null;

  // @property({ tooltip: "Tốc độ di chuyển (px/giây)" })
  speed: number = 150;

  @property({ tooltip: "Khoảng chạy vượt ra ngoài mép board (px)" })
  outDistance: number = 40;

  // ---- Animation (sp.Skeleton) ----
  @property({
    type: Node,
    tooltip: "Node chứa sp.Skeleton; để trống nếu skeleton ở chính node này",
  })
  skeletonNode: Node | null = null;

  animLeft: string = "l_move";
  animRight: string = "r_move";
  animUp: string = "b_move";
  animDown: string = "f_move";

  @property({
    tooltip: "Anim đứng yên khi dừng (optional, để trống nếu không dùng)",
  })
  idleAnim: string = "";

  // ---- Debug ----
  @property({ tooltip: "Bật log debug" })
  debugLogs: boolean = false;

  private _moving = false;

  onEnable() {
    this.node.on(Input.EventType.TOUCH_END, this.onClick, this);
  }
  onDisable() {
    this.node.off(Input.EventType.TOUCH_END, this.onClick, this);
  }

  // ===== Main click =====
  private async onClick() {
    if (this._moving) return;

    const board = this.getBoard();
    if (!board) {
      console.warn("[OutSimpleAnim] Chưa gán boardNode (Board).");
      return;
    }

    const ui: UITransform | null = this.boardNode!.getComponent(UITransform);
    if (!ui) {
      console.warn("[OutSimpleAnim] Board thiếu UITransform.");
      return;
    }

    // 1) Vị trí lưới hiện tại
    const cur = this.resolveCurrentRC(board);
    if (!cur) return;

    // 2) Chọn hướng có thể đi: ưu tiên facing, rồi thử 3 hướng còn lại (xoay CW)
    const chosen = this.pickFirstAvailableDir(board, cur.r, cur.c, this.facing);
    if (chosen == null) {
      // không có hướng nào đi được
      this.playIdleIfAny();
      return;
    }

    // 3) Cập nhật facing theo hướng được chọn + emit event tương ứng
    if (this.facing !== chosen) this.facing = chosen;
    if (this.facing === Dir.Up) this.node.emit("start-move-top", this.node, this.facing);
    else if (this.facing === Dir.Down) this.node.emit("start-move-bottom", this.node, this.facing);

    const { dr, dc } = this.dirDelta(this.facing);
    const nr = cur.r + dr;
    const nc = cur.c + dc;

    // Nếu bước đầu tiên đã RA NGOÀI board → cho phép đi luôn (không cần kiểm tra)
    const outImmediately =
      nr < 0 || nr >= board.rows || nc < 0 || nc >= board.cols;

    // (Với hướng đã chọn) nếu còn trong board, CHỈ kiểm tra ô KẾ TIẾP (nếu bị chắn thì dừng)
    if (!outImmediately) {
      const probe: Probe = board.straightLineTarget(cur.r, cur.c, dr, dc);
      if (this.debugLogs)
        console.log("[OutSimpleAnim] probe", {
          cur,
          facing: Dir[this.facing],
          dr,
          dc,
          probe,
        });

      // Nếu bị chắn ngay trước mặt ⇒ KHÔNG chạy
      if (!probe || !probe.canGo) {
        this.playIdleIfAny();
        return;
      }
      // Bỏ qua các chướng ngại xa hơn: yêu cầu là chạy thẳng RA NGOÀI board.
    }

    this._moving = true;

    // 4) Bật ANIM theo hướng di chuyển (không xoay node)
    this.playMoveAnim(this.facing);

    // 5) Tính đích ở NGOÀI mép board (giữ hàng/cột hiện tại) rồi tween tới đó
    const targetWorld = this.computeOutsideTargetWorld(
      board,
      ui,
      cur.r,
      cur.c,
      this.facing
    );

    // Rời occupancy tại ô hiện tại (đi ra ngoài board)
    if (typeof board.clearAt === "function") {
      board.clearAt(cur.r, cur.c, this.node);
    }

    const start = this.node.worldPosition.clone();
    const dist = Vec3.distance(start, targetWorld);
    const dur = Math.max(0.01, dist / Math.max(1, this.speed));

    await new Promise<void>((res) =>
      tween(this.node).to(dur, { worldPosition: targetWorld }).call(res).start()
    );

    this._moving = false;
    this.playIdleIfAny(); // nếu có idle
  }

  // ===== Direction picking =====
  /**
   * Trả về hướng khả dụng đầu tiên theo thứ tự:
   * 1) facing hiện tại
   * 2) quay phải (CW +1)
   * 3) quay tiếp (CW +2)
   * 4) quay tiếp (CW +3) ~ ngược lại
   * Điều kiện "đi được":
   *  - Nếu bước đầu ra ngoài board -> OK
   *  - Nếu còn trong board: straightLineTarget(cur, dir).canGo == true (tức ô kế tiếp trống)
   */
  private pickFirstAvailableDir(board: any, r: number, c: number, facing: Dir): Dir | null {
    const seq: Dir[] = [
      facing,
      ((facing + 1) % 4) as Dir,
      ((facing + 2) % 4) as Dir,
      ((facing + 3) % 4) as Dir,
    ];

    for (const d of seq) {
      const { dr, dc } = this.dirDelta(d);
      const nr = r + dr;
      const nc = c + dc;

      const outImmediately =
        nr < 0 || nr >= board.rows || nc < 0 || nc >= board.cols;

      if (outImmediately) return d;

      // còn trong board -> chỉ cần ô kế tiếp không bị chắn
      const probe: Probe = board.straightLineTarget(r, c, dr, dc);
      if (probe && probe.canGo) return d;
    }
    return null;
  }

  // ===== Helpers =====
  private getBoard(): any | null {
    return this.boardNode?.getComponent("Board") ?? null;
  }

  private resolveCurrentRC(board: any): RC | null {
    if (typeof board.getRCOfAnimal === "function") {
      const got = board.getRCOfAnimal(this.node);
      if (got) return got;
    }
    if (typeof board.worldToRC !== "function") return null;
    return board.worldToRC(this.node.worldPosition);
  }

  /** Tính target nằm NGOÀI mép theo hướng facing, lệch khỏi biên outDistance px */
  private computeOutsideTargetWorld(
    board: any,
    ui: UITransform,
    r: number,
    c: number,
    dir: Dir
  ): Vec3 {
    const cellCenterWorld: Vec3 = board.rcToWorld(r, c);
    const cellCenterLocal = ui.convertToNodeSpaceAR(cellCenterWorld);

    const halfW = ui.width / 2;
    const halfH = ui.height / 2;

    let tx = cellCenterLocal.x;
    let ty = cellCenterLocal.y;

    if (dir === Dir.Right) tx = halfW + this.outDistance;
    if (dir === Dir.Left) tx = -halfW - this.outDistance;
    if (dir === Dir.Up) ty = halfH + this.outDistance;
    if (dir === Dir.Down) ty = -halfH - this.outDistance;

    const targetLocal = new Vec3(tx, ty, 0);
    const targetWorld = ui.convertToWorldSpaceAR(targetLocal);
    if (this.debugLogs)
      console.log("[OutSimpleAnim] outside target", {
        dir: Dir[dir],
        targetWorld,
      });
    return targetWorld;
  }

  // ---- Anim control ----
  private getSkeleton(): sp.Skeleton | null {
    const n = this.skeletonNode ?? this.node;
    return n.getComponent(sp.Skeleton);
  }

  private playMoveAnim(dir: Dir) {
    const sk = this.getSkeleton();
    if (!sk) return;

    const anim =
      dir === Dir.Left
        ? this.animLeft
        : dir === Dir.Right
        ? this.animRight
        : dir === Dir.Down
        ? this.animDown
        : this.animUp; // Up

    try {
      sk.setAnimation(0, anim, true);
    } catch (e) {
      console.warn("[OutSimpleAnim] setAnimation failed:", e, "anim=", anim);
    }
  }

  private playIdleIfAny() {
    if (!this.idleAnim) return;
    const sk = this.getSkeleton();
    if (!sk) return;
    try {
      sk.setAnimation(0, this.idleAnim, true);
    } catch (e) {
      console.warn("[OutSimpleAnim] idle setAnimation failed:", e);
    }
  }

  // ---- Direction utils (viewer-space) ----
  private dirDelta(d: Dir): { dr: number; dc: number } {
    // r tăng = đi xuống; c tăng = đi sang phải
    switch (d) {
      case Dir.Up:
        return { dr: -1, dc: 0 };
      case Dir.Right:
        return { dr: 0, dc: +1 };
      case Dir.Down:
        return { dr: +1, dc: 0 };
      case Dir.Left:
        return { dr: 0, dc: -1 };
    }
  }
}

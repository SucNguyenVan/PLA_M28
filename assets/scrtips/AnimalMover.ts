// Cocos Creator 3.x
import { _decorator, Component, Node, Input, EventTouch, tween, Vec3, sp, Enum } from 'cc';
const { ccclass, property } = _decorator;

/** Hướng theo NGƯỜI NHÌN (viewer-space): Up = lên màn hình, Down = xuống, Left = trái, Right = phải */
enum Dir { Up = 0, Right = 1, Down = 2, Left = 3 }

type RC = { r: number; c: number };
type Probe = { canGo: boolean; endR: number; endC: number; hitEdge: boolean };

@ccclass('AnimalMover')
export class AnimalMover extends Component {
  // ===== CẤU HÌNH CHUYỂN ĐỘNG =====
  @property({ type: Enum(Dir), tooltip: 'Hướng “đang nhìn” khi click (viewer-space)' })
  facing: Dir = Dir.Right;

  @property({ tooltip: 'Đảo TRÁI/PHẢI khi tính đường trong GRID (nếu level của bạn đang bị mirror ngang)' })
  invertLRGrid: boolean = false;

  @property({ tooltip: 'Đảo LÊN/XUỐNG khi tính đường trong GRID (nếu level của bạn đang bị mirror dọc)' })
  invertUDGrid: boolean = false;

  @property({ tooltip: 'Tốc độ px/giây' })
  speed: number = 800;

  @property({ type: Node, tooltip: 'Node có gắn Board.ts (@ccclass = "Board")' })
  boardNode: Node | null = null;

  @property({ type: Node, tooltip: 'Node có gắn PathManager.ts (@ccclass = "PathManager")' })
  pathNode: Node | null = null;

  // ===== CẤU HÌNH ANIMATION (không xoay node) =====
  @property({ type: Node, tooltip: 'Node chứa sp.Skeleton; để trống nếu skeleton ở chính node này' })
  skeletonNode: Node | null = null;

  @property({ tooltip: 'Anim đi TRÁI' })  animLeft: string  = 'l_move';
  @property({ tooltip: 'Anim đi PHẢI' })  animRight: string = 'r_move';
  @property({ tooltip: 'Anim đi LÊN' })   animUp: string    = 'f_move';
  @property({ tooltip: 'Anim đi XUỐNG' }) animDown: string  = 'b_move';
  @property({ tooltip: 'Anim đứng yên (optional)' }) idleAnim: string = '';

  @property({ tooltip: 'Nếu rig đặt tên ngược, đảo anim Trái/Phải (chỉ ảnh hưởng anim, KHÔNG ảnh hưởng hướng chạy)' })
  flipLRForAnim: boolean = false;

  @property({ tooltip: 'Nếu rig đặt tên ngược, đảo anim Lên/Xuống (chỉ ảnh hưởng anim)' })
  flipUDForAnim: boolean = false;

  @property({ tooltip: 'In log debug hướng/đích' })
  debugLogs: boolean = false;

  // ===== STATE =====
  private _moving = false;
  private _lastAnimDir: Dir | null = null;

  // ===== BINDINGS =====
  onEnable() { this.node.on(Input.EventType.TOUCH_END, this.onTouch, this); }
  onDisable() { this.node.off(Input.EventType.TOUCH_END, this.onTouch, this); }

  private getBoard(): any | null { return this.boardNode?.getComponent('Board') ?? null; }
  private getPath():  any | null { return this.pathNode?.getComponent('PathManager') ?? null; }
  private getGridAnchor(): any | null { return this.node.getComponent('GridAnchor'); } // optional

  // ===== MAIN CLICK =====
  private async onTouch(e: EventTouch) {
    if (this._moving) return;

    const board = this.getBoard();
    const path  = this.getPath();
    if (!board || !path) {
      console.warn('[AnimalMover] Thiếu Board/PathManager. Kéo đúng node vào Inspector.');
      return;
    }

    const cur = this.resolveCurrentRC(board);
    if (!cur) return;

    // 1) Chạy THẲNG theo hướng đã đánh dấu (có xét invertLR/UD cho GRID)
    const { dr, dc } = this.dirDeltaGrid(this.facing);
    const probe: Probe = board.straightLineTarget(cur.r, cur.c, dr, dc);
    if (this.debugLogs) console.log('[AnimalMover] click', { facing: Dir[this.facing], dr, dc, cur, probe });

    if (!probe?.canGo) { this.playIdleIfAny(); return; } // bị chắn ngay trước mặt

    this._moving = true;

    // Anim theo hướng chạy trong grid (viewer-space, không dùng invert anim)
    this.playMoveAnim(this.deltaToViewerDir(dr, dc));

    // 2) Trượt tới ô end trong grid
    const endPos: Vec3 = board.rcToWorld(probe.endR, probe.endC);
    await this.updateOccupancyAndMove(board, cur.r, cur.c, probe.endR, probe.endC, endPos);

    if (!probe.hitEdge) { // không ra mép ⇒ dừng
      this._moving = false;
      this.playIdleIfAny();
      return;
    }

    // 3) Chạm mép ⇒ tới Exit theo hướng đã đánh dấu (viewer-space)
    const exitPos: Vec3 = path.getExitWorld(this.facingName(this.facing));
    await this.moveVisualTo(exitPos);

    // 4) Bám Perimeter → ToBarn
    const waypoints: Vec3[] = path.buildPathFromExit(this.facingName(this.facing));
    for (const p of waypoints) {
      await this.moveVisualTo(p); // mỗi chặng tự set anim theo vector
    }

    // 5) Tới chuồng
    this.node.emit('arrived-barn');
    this._moving = false;
    this.playIdleIfAny();
  }

  // ===== BOARD HELPERS =====
  private resolveCurrentRC(board: any): RC | null {
    if (typeof board.getRCOfAnimal === 'function') {
      const got = board.getRCOfAnimal(this.node);
      if (got) return got;
    }
    if (typeof board.worldToRC !== 'function') {
      console.warn('[AnimalMover] Board thiếu worldToRC.');
      return null;
    }
    const center = this.getVisualCenterWorld();
    return board.worldToRC(center);
  }

  private async updateOccupancyAndMove(
    board: any, r0: number, c0: number, r1: number, c1: number, worldTarget: Vec3
  ) {
    if (typeof board.clearAt === 'function' && typeof board.placeAnimal === 'function') {
      board.clearAt(r0, c0, this.node);
      board.placeAnimal(this.node, r1, c1);
    }
    await this.moveVisualTo(worldTarget);
  }

  // ===== MOVE & ANIM =====
  private getVisualCenterWorld(): Vec3 {
    const ga = this.getGridAnchor();
    if (ga && ga.pivot) return ga.pivot.worldPosition.clone();
    return this.node.worldPosition.clone();
  }

  private moveVisualTo(target: Vec3): Promise<void> {
    return new Promise(resolve => {
      const start = this.getVisualCenterWorld();
      const dx = target.x - start.x;
      const dy = target.y - start.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 0.5) { resolve(); return; }

      // Chọn anim theo vector hiển thị (viewer-space)
      const dir = this.vecToViewerDir(dx, dy);
      this.playMoveAnim(dir);

      const dur = Math.max(0.01, dist / Math.max(1, this.speed));
      const ga = this.getGridAnchor();
      if (ga && typeof ga.alignedWorldPosition === 'function') {
        const endPos = ga.alignedWorldPosition(target);
        tween(this.node).to(dur, { worldPosition: endPos }).call(resolve).start();
      } else {
        tween(this.node).to(dur, { worldPosition: target }).call(resolve).start();
      }
    });
  }

  private getSkeleton(): sp.Skeleton | null {
    const n = this.skeletonNode ?? this.node;
    return n.getComponent(sp.Skeleton);
  }

  private playMoveAnim(dir: Dir) {
    // Cho phép đảo ANIM nếu rig đặt tên ngược
    let d = dir;
    if (this.flipLRForAnim) {
      if (d === Dir.Left) d = Dir.Right; else if (d === Dir.Right) d = Dir.Left;
    }
    if (this.flipUDForAnim) {
      if (d === Dir.Up) d = Dir.Down; else if (d === Dir.Down) d = Dir.Up;
    }

    if (this._lastAnimDir === d) return;
    this._lastAnimDir = d;

    const sk = this.getSkeleton();
    if (!sk) return;

    const anim =
      d === Dir.Left  ? this.animLeft  :
      d === Dir.Right ? this.animRight :
      d === Dir.Down  ? this.animDown  :
                        this.animUp;   // Up

    try { sk.setAnimation(0, anim, true); }
    catch (e) { console.warn('[AnimalMover] setAnimation failed:', e, 'anim=', anim); }

    if (this.debugLogs) console.log('[AnimalMover] playMoveAnim', { dir: Dir[dir], anim, flipLR: this.flipLRForAnim, flipUD: this.flipUDForAnim });
  }

  private playIdleIfAny() {
    if (!this.idleAnim) { this._lastAnimDir = null; return; }
    const sk = this.getSkeleton();
    if (!sk) { this._lastAnimDir = null; return; }
    try { sk.setAnimation(0, this.idleAnim, true); }
    catch (e) { console.warn('[AnimalMover] idle setAnimation failed:', e); }
    this._lastAnimDir = null;
  }

  // ===== DIRECTION UTILS =====
  /** Dir -> (dr,dc) cho GRID, có xét invertLR/UD nếu cần (chỉ ảnh hưởng logic đi thẳng trong board) */
  private dirDeltaGrid(d: Dir): { dr: number; dc: number } {
    // Mặc định: r tăng = đi xuống; c tăng = đi sang phải.
    let dr = 0, dc = 0;
    if (d === Dir.Up)    { dr = -1; dc = 0; }
    if (d === Dir.Right) { dr = 0;  dc = +1; }
    if (d === Dir.Down)  { dr = +1; dc = 0; }
    if (d === Dir.Left)  { dr = 0;  dc = -1; }

    if (this.invertLRGrid) dc = -dc;
    if (this.invertUDGrid) dr = -dr;
    return { dr, dc };
  }

  /** (dr,dc) -> Dir hiển thị (viewer-space) để chọn anim phù hợp */
  private deltaToViewerDir(dr: number, dc: number): Dir {
    // Không đảo theo invert*, vì anim cần đúng hướng hiển thị
    if (dr === 0 && dc < 0) return Dir.Left;
    if (dr === 0 && dc > 0) return Dir.Right;
    if (dc === 0 && dr > 0) return Dir.Down;
    return Dir.Up;
  }

  /** Vector world → Dir hiển thị (viewer-space). Cocos UI: X+ = phải, Y+ = lên. */
  private vecToViewerDir(dx: number, dy: number): Dir {
    if (Math.abs(dx) >= Math.abs(dy)) {
      return dx >= 0 ? Dir.Right : Dir.Left;
    } else {
      return dy >= 0 ? Dir.Up : Dir.Down;
    }
  }

  private facingName(d: Dir): 'Up' | 'Right' | 'Down' | 'Left' {
    return d === Dir.Up ? 'Up' : d === Dir.Right ? 'Right' : d === Dir.Down ? 'Down' : 'Left';
  }
}

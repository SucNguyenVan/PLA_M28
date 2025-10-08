// Cocos Creator 3.x
import { _decorator, Component, Node, Vec3 } from 'cc';
import { Dir } from './Dir';
const { ccclass, property } = _decorator;

@ccclass('PathManager')
export class PathManager extends Component {
  @property({ type: Node }) ExitUp: Node | null = null;
  @property({ type: Node }) ExitDown: Node | null = null;
  @property({ type: Node }) ExitLeft: Node | null = null;
  @property({ type: Node }) ExitRight: Node | null = null;

  @property({ type: [Node], tooltip: 'Waypoints chạy quanh mép theo chiều kim đồng hồ' })
  Perimeter: Node[] = [];

  @property({ type: [Node], tooltip: 'Đường rẽ xuống chuồng; node cuối là chuồng' })
  ToBarn: Node[] = [];

  @property({ tooltip: 'Luôn đi theo chiều kim đồng hồ trên Perimeter' })
  clockwise = true;

  getExitWorld(dir: Dir): Vec3 {
    const n =
      dir === Dir.Up ? this.ExitUp :
      dir === Dir.Down ? this.ExitDown :
      dir === Dir.Left ? this.ExitLeft :
      this.ExitRight;
    if (!n) throw new Error(`[PathManager] Exit for ${Dir[dir]} is not set`);
    return n.worldPosition.clone();
  }

  /** Trả về mảng waypoint: exit → (dọc perimeter, theo chiều đã chọn) → ToBarn */
  buildPathFromExit(dir: Dir): Vec3[] {
    const pts: Vec3[] = [];
    const exit = this.getExitWorld(dir);
    pts.push(exit);

    // Nếu không có perimeter, đi thẳng theo ToBarn
    if (!this.Perimeter || this.Perimeter.length === 0) {
      this.ToBarn.forEach(n => pts.push(n.worldPosition.clone()));
      return pts;
    }

    // Tìm index trên perimeter gần Exit và gần ToBarn[0]
    const iEnter = this.nearestIndexOn(this.Perimeter, exit);
    const barnEntry = this.ToBarn?.[0]?.worldPosition?.clone();
    const iBarn = barnEntry ? this.nearestIndexOn(this.Perimeter, barnEntry) : iEnter;

    // Đi từ iEnter → iBarn theo 1 chiều cố định (clockwise)
    const ring = this.walkRing(this.Perimeter, iEnter, iBarn, this.clockwise);
    ring.forEach(n => pts.push(n.worldPosition.clone()));

    // Thêm đường xuống chuồng
    this.ToBarn.forEach(n => pts.push(n.worldPosition.clone()));
    return pts;
  }

  getBarnWorld(): Vec3 | null {
    return this.ToBarn.length ? this.ToBarn[this.ToBarn.length - 1].worldPosition.clone() : null;
  }

  // ==== helpers ====
  private nearestIndexOn(nodes: Node[], p: Vec3): number {
    let best = 0, dmin = Infinity;
    nodes.forEach((n, i) => {
      const d = Vec3.squaredDistance(n.worldPosition, p);
      if (d < dmin) { dmin = d; best = i; }
    });
    return best;
  }

  private walkRing(nodes: Node[], fromIdx: number, toIdx: number, clockwise: boolean): Node[] {
    if (!nodes.length) return [];
    const L = nodes.length;
    const res: Node[] = [];
    let i = fromIdx;
    // tránh lặp vô hạn: tối đa L bước + 1 để lấy toIdx
    for (let step = 0; step <= L; step++) {
      res.push(nodes[i]);
      if (i === toIdx) break;
      i = clockwise ? (i + 1) % L : (i - 1 + L) % L;
    }
    return res;
  }
}

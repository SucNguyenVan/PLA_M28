// assets/scripts/Board.ts
// Cocos Creator 3.x
import { _decorator, Component, Node, UITransform, Vec3, Rect } from 'cc';
import { GridAnchor } from './GridAnchor'; // optional: không bắt buộc phải gắn
const { ccclass, property } = _decorator;

@ccclass('Board')
export class Board extends Component {
  // ===== Cấu hình Grid =====
  @property({ tooltip: 'Số cột của grid' })
  cols = 5;

  @property({ tooltip: 'Số hàng của grid' })
  rows = 5;

  @property({ tooltip: 'Padding mép trong (px) để chừa viền/ hàng rào' })
  innerPadding = 16;

  @property({ tooltip: 'Ép ô vuông (cellX = cellY = min). Tắt để cho phép ô chữ nhật.' })
  squareCells = true;

  // ===== Nguồn animals (để auto-snap) =====
  @property({ type: Node, tooltip: 'Parent chứa các con vật (animals)' })
  animalsParent: Node | null = null;

  @property({ tooltip: 'Tự snap tất cả animals vào ô gần nhất ở start()' })
  snapNearestOnStart = false;

  @property({ tooltip: 'Bao gồm cả node con đang inactive khi snap' })
  includeInactive = false;

  @property({ tooltip: 'Nếu số animal > số ô: true = cắt bớt, false = báo lỗi' })
  clampOverflow = true;

  // ===== Runtime =====
  private ui!: UITransform;
  private cellX = 0;   // tâm-đến-tâm theo X
  private cellY = 0;   // tâm-đến-tâm theo Y
  private gridW = 0;   // bề rộng vùng grid đã fit
  private gridH = 0;   // bề cao vùng grid đã fit

  // occupancy[r][c] = Node (animal) hoặc null
  private occupancy: (Node | null)[][] = [];

  // ===== Lifecycle =====
  onLoad() {
    this.ui = this.node.getComponent(UITransform)!;
    if (!this.ui) throw new Error('[Board] Node phải có UITransform (Content Size).');

    this.computeGeometry();
    this.resetGrid();
  }

  start() {
    // Nếu Widget / layout thay đổi size ở frame đầu → tính lại.
    this.computeGeometry();
    if (this.snapNearestOnStart) {
      this.layoutAnimalsByNearest();
    }
  }

  // ===== Public API (hình học & quy đổi) =====

  /** Tính cell size & vùng grid từ Content Size (có xét padding & ép ô vuông). Gọi lại nếu size/rows/cols đổi lúc chạy. */
  public computeGeometry() {
    const w = Math.max(1, this.ui.width - this.innerPadding * 2);
    const h = Math.max(1, this.ui.height - this.innerPadding * 2);

    const rawCellX = w / Math.max(1, this.cols);
    const rawCellY = h / Math.max(1, this.rows);

    if (this.squareCells) {
      const cell = Math.min(rawCellX, rawCellY);
      this.cellX = this.cellY = cell;
      this.gridW = cell * this.cols;
      this.gridH = cell * this.rows;
    } else {
      this.cellX = rawCellX;
      this.cellY = rawCellY;
      this.gridW = rawCellX * this.cols;
      this.gridH = rawCellY * this.rows;
    }
  }

  /** Xoá & tạo lại ma trận occupancy (không đụng tới scene). */
  public resetGrid() {
    this.occupancy = [];
    for (let r = 0; r < this.rows; r++) {
      this.occupancy[r] = [];
      for (let c = 0; c < this.cols; c++) this.occupancy[r][c] = null;
    }
  }

  /** (r,c) -> world-position (tâm ô). Anchor-agnostic: luôn center theo Content Size. */
  public rcToWorld(r: number, c: number): Vec3 {
    this.assertRC(r, c);
    const tl = this.topLeftLocalAnchorAware();
    const x = tl.x + (c + 0.5) * this.cellX;
    const y = tl.y - (r + 0.5) * this.cellY;
    return this.ui.convertToWorldSpaceAR(new Vec3(x, y, 0));
  }

  /** world-position -> (r,c) gần nhất (đã clamp về biên). */
  public worldToRC(world: Vec3): { r: number; c: number } {
    const local = this.ui.convertToNodeSpaceAR(world);
    const tl = this.topLeftLocalAnchorAware();
    const cFloat = (local.x - tl.x) / this.cellX - 0.5;
    const rFloat = (tl.y - local.y) / this.cellY - 0.5;
    const c = Math.max(0, Math.min(this.cols - 1, Math.round(cFloat)));
    const r = Math.max(0, Math.min(this.rows - 1, Math.round(rFloat)));
    return { r, c };
  }

  // ===== Public API (occupancy) =====

  /** Ghi occupancy và đặt node vào tâm ô (dịch chuyển ngay). Có hỗ trợ GridAnchor nếu gắn trên animal. */
  public placeAnimal(animal: Node, r: number, c: number) {
    this.assertRC(r, c);
    this.occupancy[r][c] = animal;
    const center = this.rcToWorld(r, c);

    const ga = animal.getComponent(GridAnchor) as any;
    if (ga && typeof ga.alignTo === 'function') {
      ga.alignTo(center); // căn theo pivot/AABB → chính giữa thị giác
    } else {
      animal.setWorldPosition(center);
    }
  }

  /** Xoá occupancy tại (r,c) nếu đúng node đó. */
  public clearAt(r: number, c: number, animal: Node) {
    this.assertRC(r, c);
    if (this.occupancy[r][c] === animal) {
      this.occupancy[r][c] = null;
    }
  }

  /** Tìm (r,c) hiện tại của 1 animal đã được place ghi vào occupancy. */
  public getRCOfAnimal(animal: Node): { r: number; c: number } | null {
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++)
        if (this.occupancy[r][c] === animal) return { r, c };
    return null;
  }

  // ===== Public API (lao thẳng tới mép / vật cản) =====

  /**
   * Từ (r,c) đi thẳng theo (dr,dc) tới khi:
   *  - rời khỏi board → dừng ở ô cuối trong board, hitEdge=true (kể cả khi đang đứng sát mép và bước đầu ra ngoài),
   *  - gặp chướng ngại (ô có animal) → dừng ngay trước chướng ngại (hitEdge=false).
   * Trả về: canGo (có di chuyển được / hoặc đang ở mép nhưng vẫn được coi là đi để nhập Exit), endR,endC, hitEdge.
   */
  public straightLineTarget(
    r: number,
    c: number,
    dr: number,
    dc: number
  ): { canGo: boolean; endR: number; endC: number; hitEdge: boolean } {
    this.assertRC(r, c);
    let nr = r, nc = c;

    while (true) {
      const tr = nr + dr;
      const tc = nc + dc;

      // Nếu bước tiếp theo ra ngoài board → coi như đã chạm mép tại (nr,nc)
      if (tr < 0 || tr >= this.rows || tc < 0 || tc >= this.cols) {
        // *** FIX: cho phép canGo = true ngay cả khi chưa di chuyển ô nào (đang đứng sát mép) ***
        return { canGo: true, endR: nr, endC: nc, hitEdge: true };
      }

      // Gặp chướng ngại → dừng tại (nr,nc). Nếu chưa nhúc nhích thì canGo=false.
      if (this.occupancy[tr][tc]) {
        const moved = !(nr === r && nc === c);
        return { canGo: moved, endR: nr, endC: nc, hitEdge: false };
      }

      // Trống → bước tiếp
      nr = tr; nc = tc;
    }
  }

  // ===== Auto-snap animals vào ô gần nhất (Hungarian) =====

  /** Snap tất cả children trong animalsParent vào các ô gần nhất (giải gán tối ưu để không trùng ô). */
  public layoutAnimalsByNearest() {
    if (!this.animalsParent) {
      console.warn('[Board] animalsParent chưa gán.');
      return;
    }

    // 1) Danh sách animals
    let animals = this.animalsParent.children.filter(n => this.includeInactive ? true : n.active);

    // 2) Kiểm tra sức chứa
    const capacity = this.rows * this.cols;
    if (animals.length > capacity) {
      const extra = animals.length - capacity;
      const msg = `[Board] Số animal (${animals.length}) > số ô (${capacity}).`;
      if (this.clampOverflow) {
        console.warn(msg + ` Sẽ chỉ snap ${capacity}, bỏ qua ${extra}.`);
        animals = animals.slice(0, capacity);
      } else {
        throw new Error(msg + ' Hãy tăng rows/cols hoặc giảm số animal.');
      }
    }

    // 3) Danh sách tất cả ô và tâm world của ô
    const cells: { r: number; c: number; pos: Vec3 }[] = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        cells.push({ r, c, pos: this.rcToWorld(r, c) });
      }
    }

    // 4) Tâm "thị giác" hiện tại của từng animal (ưu tiên GridAnchor; fallback: AABB; fallback nữa: worldPosition)
    const centers = animals.map(a => this.getVisualCenterWorld(a));

    // 5) Ma trận chi phí m x n (bình phương khoảng cách)
    const m = animals.length;
    const n = cells.length;
    const cost: number[][] = Array.from({ length: m }, () => Array(n).fill(0));
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < n; j++) {
        const dx = centers[i].x - cells[j].pos.x;
        const dy = centers[i].y - cells[j].pos.y;
        cost[i][j] = dx * dx + dy * dy;
      }
    }

    // 6) Hungarian: gán m animals vào n ô (m <= n)
    const assign = this.solveAssignment(cost); // assign[i] = index ô (cột) cho animal i

    // 7) Ghi occupancy & đặt lại vị trí
    this.resetGrid();
    for (let i = 0; i < m; i++) {
      const j = assign[i];
      const { r, c, pos } = cells[j];
      this.occupancy[r][c] = animals[i];
      this.placeNodeVisualCenter(animals[i], pos);
    }
  }

  // ===== Private helpers =====

  /** Top-left của vùng grid trong local space, luôn center theo hình chữ nhật Board (không lệ thuộc anchor). */
  private topLeftLocalAnchorAware(): Vec3 {
    const ax = this.ui.anchorPoint.x;
    const ay = this.ui.anchorPoint.y;
    const centerX = (0.5 - ax) * this.ui.width;
    const centerY = (0.5 - ay) * this.ui.height;
    return new Vec3(centerX - this.gridW / 2, centerY + this.gridH / 2, 0);
  }

  private assertRC(r: number, c: number) {
    if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) {
      throw new Error(`[Board] (r,c) ngoài biên: (${r}, ${c})`);
    }
  }

  /** Lấy tâm "thị giác" world của node: ưu tiên GridAnchor.pivot → AABB UITransform → worldPosition. */
  private getVisualCenterWorld(node: Node): Vec3 {
    const ga = node.getComponent(GridAnchor) as any;
    if (ga && ga.pivot) {
      return (ga.pivot as Node).worldPosition.clone();
    }
    const uts = node.getComponentsInChildren(UITransform);
    if (uts.length > 0) {
      let minX = Number.POSITIVE_INFINITY, minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY, maxY = Number.NEGATIVE_INFINITY;
      for (const ut of uts) {
        const r: Rect = ut.getBoundingBoxToWorld();
        const x1 = r.x, y1 = r.y, x2 = r.x + r.width, y2 = r.y + r.height;
        if (x1 < minX) minX = x1;
        if (y1 < minY) minY = y1;
        if (x2 > maxX) maxX = x2;
        if (y2 > maxY) maxY = y2;
      }
      if (isFinite(minX) && isFinite(maxX)) {
        return new Vec3((minX + maxX) / 2, (minY + maxY) / 2, node.worldPosition.z);
      }
    }
    return node.worldPosition.clone();
  }

  /** Đặt node sao cho tâm "thị giác" của nó trùng targetCenter. */
  private placeNodeVisualCenter(node: Node, targetCenter: Vec3) {
    const ga = node.getComponent(GridAnchor) as any;
    if (ga && typeof ga.alignTo === 'function') {
      ga.alignTo(targetCenter);
    } else {
      node.setWorldPosition(targetCenter);
    }
  }

  /** Giải bài toán gán tối ưu (Hungarian) cho ma trận chi phí m x n (m <= n). Trả về m phần tử: cột (ô) được gán cho mỗi hàng (animal). */
  private solveAssignment(costRect: number[][]): number[] {
    const m = costRect.length;
    const n = costRect[0]?.length ?? 0;
    if (m === 0 || n === 0) return [];

    // Chuyển sang ma trận vuông N x N với N = n (n >= m), pad chi phí lớn cho hàng ảo.
    const N = n;
    const BIG = 1e12;
    const a: number[][] = Array.from({ length: N }, (_, i) => {
      const row = Array.from({ length: N }, () => BIG);
      if (i < m) {
        for (let j = 0; j < n; j++) row[j] = costRect[i][j];
      }
      return row;
    });

    // Hungarian 1-based
    const u = Array(N + 1).fill(0);
    const v = Array(N + 1).fill(0);
    const p = Array(N + 1).fill(0);
    const way = Array(N + 1).fill(0);

    for (let i = 1; i <= N; i++) {
      p[0] = i;
      let j0 = 0;
      const minv = Array(N + 1).fill(Infinity);
      const used = Array(N + 1).fill(false);

      do {
        used[j0] = true;
        const i0 = p[j0];
        let delta = Infinity, j1 = 0;
        for (let j = 1; j <= N; j++) {
          if (used[j]) continue;
          const cur = a[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) {
            minv[j] = cur;
            way[j] = j0;
          }
          if (minv[j] < delta) {
            delta = minv[j];
            j1 = j;
          }
        }
        for (let j = 0; j <= N; j++) {
          if (used[j]) {
            u[p[j]] += delta;
            v[j] -= delta;
          } else {
            minv[j] -= delta;
          }
        }
        j0 = j1;
      } while (p[j0] !== 0);

      do {
        const j1 = way[j0];
        p[j0] = p[j1];
        j0 = j1;
      } while (j0 !== 0);
    }

    // p[j] = i  ⇒ hàng i gán cho cột j
    const ans: number[] = Array(m).fill(-1);
    for (let j = 1; j <= N; j++) {
      const i = p[j];
      if (i >= 1 && i <= m && j >= 1 && j <= n) ans[i - 1] = j - 1;
    }

    // fallback nếu còn -1 (hiếm khi)
    for (let i = 0; i < m; i++) {
      if (ans[i] === -1) {
        let best = -1, bestVal = Infinity;
        const taken = new Set(ans.filter(x => x >= 0));
        for (let j = 0; j < n; j++) {
          if (taken.has(j)) continue;
          const val = costRect[i][j];
          if (val < bestVal) { bestVal = val; best = j; }
        }
        ans[i] = best >= 0 ? best : 0;
      }
    }
    return ans;
  }
}

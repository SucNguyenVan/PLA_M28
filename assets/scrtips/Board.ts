// assets/scripts/Board.ts
// Cocos Creator 3.x
import { _decorator, Component, Node, Vec3, UITransform, Rect } from "cc";
import { GridAnchor } from "./GridAnchor"; // nếu không dùng GridAnchor có thể giữ nguyên, script vẫn chạy
const { ccclass, property } = _decorator;

@ccclass("Board")
export class Board extends Component {
  // ---- Cấu hình grid ----
  @property({ tooltip: "Số cột" }) cols = 5;
  @property({ tooltip: "Số hàng" }) rows = 5;

  @property({ tooltip: "Padding mép trong (px)" })
  innerPadding = 16;

  @property({ tooltip: "Ép ô vuông (cellX = cellY = min)" })
  squareCells = true;

  // ---- Nguồn animal ----
  @property({ type: Node, tooltip: "Parent chứa các con vật" })
  animalsParent: Node | null = null;

  // ---- Tùy chọn snap gần nhất ----
  @property({ tooltip: "Tự snap theo ô gần nhất khi start()" })
  snapNearestOnStart = true;

  @property({ tooltip: "Bỏ qua con vật inactive" })
  includeInactive = false;

  @property({
    tooltip: "Nếu số animal > số ô: true = cắt bớt, false = báo lỗi",
  })
  clampOverflow = true;

  // ---- runtime ----
  private ui!: UITransform;
  private cellX = 0;
  private cellY = 0;
  private gridW = 0;
  private gridH = 0;

  // occupancy[r][c] = Node hoặc null
  private occupancy: (Node | null)[][] = [];

  // ===== Lifecycle =====
  onLoad() {
    this.ui = this.node.getComponent(UITransform)!;
    if (!this.ui) throw new Error("[Board] Node phải có UITransform.");
    this.computeGeometry();
    this.resetGrid();
  }

  start() {
    // Nếu Widget/layout thay đổi size ở frame đầu
    this.computeGeometry();
    if (this.snapNearestOnStart) {
      this.layoutAnimalsByNearest();
    }
  }

  // ===== API chính =====

  /** Tính cell size từ Content Size (UITransform), có xét padding & ép ô vuông nếu cần */
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

  /** Xóa & tạo lại ma trận occupancy (không động vào scene) */
  public resetGrid() {
    this.occupancy = [];
    for (let r = 0; r < this.rows; r++) {
      this.occupancy[r] = [];
      for (let c = 0; c < this.cols; c++) this.occupancy[r][c] = null;
    }
  }

  /** Snap tất cả animal trong animalsParent vào ô grid **gần nhất** (giải tối ưu để tránh trùng ô). */
  public layoutAnimalsByNearest() {
    if (!this.animalsParent) {
      console.warn("[Board] animalsParent chưa gán.");
      return;
    }

    // 1) Lấy danh sách animal
    let animals = this.animalsParent.children.filter((n) =>
      this.includeInactive ? true : n.active
    );

    // 2) Kiểm tra sức chứa
    const capacity = this.rows * this.cols;
    if (animals.length > capacity) {
      const extra = animals.length - capacity;
      const msg = `[Board] Số animal (${animals.length}) > số ô (${capacity}).`;
      if (this.clampOverflow) {
        console.warn(msg + ` Sẽ chỉ snap ${capacity}, bỏ qua ${extra}.`);
        animals = animals.slice(0, capacity);
      } else {
        throw new Error(msg + " Hãy tăng rows/cols hoặc giảm số animal.");
      }
    }

    // 3) Danh sách tất cả ô (r,c) và tâm world của ô
    const cells: { r: number; c: number; pos: Vec3 }[] = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        cells.push({ r, c, pos: this.rcToWorld(r, c) });
      }
    }

    // 4) Tâm "thị giác" hiện tại của từng animal (ưu tiên GridAnchor pivot/AABB, fallback: worldPosition)
    const centers = animals.map((a) => this.getVisualCenterWorld(a));

    // 5) Tạo ma trận chi phí (m x n): bình phương khoảng cách để ổn định
    const m = animals.length;
    const n = cells.length;
    const costRect: number[][] = Array.from({ length: m }, () =>
      Array(n).fill(0)
    );
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < n; j++) {
        const dx = centers[i].x - cells[j].pos.x;
        const dy = centers[i].y - cells[j].pos.y;
        costRect[i][j] = dx * dx + dy * dy;
      }
    }

    // 6) Giải gán tối ưu bằng Hungarian (m hàng, n cột; m <= n)
    const assign = this.solveAssignment(costRect); // assign[i] = index cột (ô) cho animal i

    // 7) Ghi occupancy & đặt lại vị trí
    this.resetGrid();
    for (let i = 0; i < m; i++) {
      const col = assign[i];
      const { r, c, pos } = cells[col];
      this.occupancy[r][c] = animals[i];
      this.placeNodeVisualCenter(animals[i], pos); // giữ đúng tâm thị giác
    }
  }

  /** Đặt 1 node sao cho "tâm thị giác" (pivot/AABB) trùng targetCenter */
  private placeNodeVisualCenter(node: Node, targetCenter: Vec3) {
    const ga = node.getComponent(GridAnchor);
    if (ga) {
      ga.alignTo(targetCenter);
      return;
    }
    // fallback: dời cả node để worldPosition của nó = targetCenter
    node.setWorldPosition(targetCenter);
  }

  /** Lấy tâm "thị giác" world: ưu tiên GridAnchor (pivot/AABB), nếu không có thì dùng worldPosition */
  private getVisualCenterWorld(node: Node): Vec3 {
    const ga = node.getComponent(GridAnchor);
    if (ga && ga["pivot"]) {
      return (ga["pivot"] as Node).worldPosition.clone();
    }
    // Tự đo AABB qua toàn bộ UITransform con (nếu có), bao gồm node hiện tại
    const uts = node.getComponentsInChildren(UITransform);
    if (uts.length > 0) {
      let minX = Number.POSITIVE_INFINITY,
        minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY,
        maxY = Number.NEGATIVE_INFINITY;
      for (const ut of uts) {
        const r: Rect = ut.getBoundingBoxToWorld();
        const x1 = r.x,
          y1 = r.y,
          x2 = r.x + r.width,
          y2 = r.y + r.height;
        if (x1 < minX) minX = x1;
        if (y1 < minY) minY = y1;
        if (x2 > maxX) maxX = x2;
        if (y2 > maxY) maxY = y2;
      }
      if (isFinite(minX) && isFinite(maxX)) {
        return new Vec3(
          (minX + maxX) / 2,
          (minY + maxY) / 2,
          node.worldPosition.z
        );
      }
    }
    return node.worldPosition.clone();
  }

  /** (r,c) -> world position (tâm ô), anchor-agnostic: luôn center theo Content Size */
  public rcToWorld(r: number, c: number): Vec3 {
    const tl = this.topLeftLocalAnchorAware();
    const x = tl.x + (c + 0.5) * this.cellX;
    const y = tl.y - (r + 0.5) * this.cellY;
    return this.ui.convertToWorldSpaceAR(new Vec3(x, y, 0));
  }

  /** world -> (r,c) gần nhất (đã clamp về biên) */
  public worldToRC(world: Vec3): { r: number; c: number } {
    const local = this.ui.convertToNodeSpaceAR(world);
    const tl = this.topLeftLocalAnchorAware();
    const cFloat = (local.x - tl.x) / this.cellX - 0.5;
    const rFloat = (tl.y - local.y) / this.cellY - 0.5;
    const c = Math.max(0, Math.min(this.cols - 1, Math.round(cFloat)));
    const r = Math.max(0, Math.min(this.rows - 1, Math.round(rFloat)));
    return { r, c };
  }

  // ===== Hungarian (Assignment Problem) =====
  /** Giải bài toán gán tối ưu tối thiểu chi phí cho ma trận m x n (m <= n). Trả về m phần tử: cột được chọn cho mỗi hàng. */
  private solveAssignment(costRect: number[][]): number[] {
    const m = costRect.length;
    const n = costRect[0]?.length ?? 0;
    if (m === 0 || n === 0) return [];

    // Chuyển thành ma trận vuông N x N với N = n (n >= m). Padding bằng chi phí lớn.
    const N = n;
    const BIG = 1e12;
    const a: number[][] = Array.from({ length: N }, (_, i) => {
      const row = Array.from({ length: N }, (_, j) => BIG);
      if (i < m) {
        for (let j = 0; j < n; j++) row[j] = costRect[i][j];
      }
      return row;
    });

    // Hungarian (phiên bản 1-based)
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
        let delta = Infinity;
        let j1 = 0;
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

    // p[j] = i nghĩa là hàng i gán cho cột j.
    // Trả về assignment cho m hàng đầu: row i -> col
    const ans: number[] = Array(m).fill(-1);
    for (let j = 1; j <= N; j++) {
      const i = p[j];
      if (i >= 1 && i <= m && j >= 1 && j <= n) {
        ans[i - 1] = j - 1;
      }
    }
    // Sanity: nếu có hàng chưa được gán (không nên xảy ra), fallback greedy
    for (let i = 0; i < m; i++) {
      if (ans[i] === -1) {
        // chọn cột trống có chi phí nhỏ nhất
        let best = -1,
          bestVal = Infinity;
        const taken = new Set(ans.filter((x) => x >= 0));
        for (let j = 0; j < n; j++) {
          if (taken.has(j)) continue;
          const val = costRect[i][j];
          if (val < bestVal) {
            bestVal = val;
            best = j;
          }
        }
        ans[i] = best >= 0 ? best : 0;
      }
    }
    return ans;
  }

  // ===== Helpers =====

  /** Top-left của vùng grid trong local space, căn giữa hình chữ nhật Board bất kể anchor */
  private topLeftLocalAnchorAware(): Vec3 {
    const ax = this.ui.anchorPoint.x;
    const ay = this.ui.anchorPoint.y;
    const centerX = (0.5 - ax) * this.ui.width;
    const centerY = (0.5 - ay) * this.ui.height;
    return new Vec3(centerX - this.gridW / 2, centerY + this.gridH / 2, 0);
  }
}

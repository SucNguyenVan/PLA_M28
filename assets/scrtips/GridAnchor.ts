// assets/scripts/GridAnchor.ts
import { _decorator, Component, Node, Vec3, UITransform, Rect } from "cc";
const { ccclass, property } = _decorator;

@ccclass("GridAnchor")
export class GridAnchor extends Component {
  @property({
    type: Node,
    tooltip: "Node con làm mốc tâm (Pivot). Để trống sẽ auto theo AABB.",
  })
  pivot: Node | null = null;

  @property({ tooltip: "Offset tinh chỉnh thêm (đơn vị: world-space)" })
  offset: Vec3 = new Vec3(0, 0, 0);

  /** Trả về world-position mới để tâm thị giác trùng targetCenter */
  public alignedWorldPosition(targetCenter: Vec3): Vec3 {
    const node = this.node;
    let newPos = targetCenter.clone();

    // Nếu có pivot: dời sao cho pivot world trùng targetCenter
    if (this.pivot) {
      const pivotOffset = this.pivot.worldPosition
        .clone()
        .subtract(node.worldPosition);
      newPos.subtract(pivotOffset);
    } else {
      // Auto: đo AABB tất cả UITransform con (kể cả chính node nếu có)
      const center = this.computeWorldAABBCenter();
      if (center) {
        const aabbOffset = center.subtract(node.worldPosition);
        newPos.subtract(aabbOffset);
      }
    }

    newPos.add(this.offset); // tinh chỉnh cuối
    return newPos;
  }

  /** Căn ngay lập tức node này sao cho tâm (pivot/AABB) trùng targetCenter */
  public alignTo(targetCenter: Vec3) {
    const pos = this.alignedWorldPosition(targetCenter);
    this.node.setWorldPosition(pos);
  }

  /** Tâm AABB world của toàn bộ UITransform con; nếu không có thì trả null */
  private computeWorldAABBCenter(): Vec3 | null {
    const uts = this.node.getComponentsInChildren(UITransform);
    if (!uts || uts.length === 0) return null;

    let minX = Number.POSITIVE_INFINITY,
      minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY,
      maxY = Number.NEGATIVE_INFINITY;

    for (const ut of uts) {
      const r: Rect = ut.getBoundingBoxToWorld();
      const x1 = r.x;
      const y1 = r.y;
      const x2 = r.x + r.width;
      const y2 = r.y + r.height;
      if (x1 < minX) minX = x1;
      if (y1 < minY) minY = y1;
      if (x2 > maxX) maxX = x2;
      if (y2 > maxY) maxY = y2;
    }

    if (!isFinite(minX) || !isFinite(maxX)) return null;
    return new Vec3(
      (minX + maxX) / 2,
      (minY + maxY) / 2,
      this.node.worldPosition.z
    );
  }
}

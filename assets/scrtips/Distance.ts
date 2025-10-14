// assets/scripts/Distance.ts
import { Node, Vec3, v3, Mat4 } from "cc";

/** Lấy world position của một node vào out (tránh tạo Vec3 mới) */
function getWorldPos(n: Node, out: Vec3): Vec3 {
  out.set(n.worldPosition);
  return out;
}

/** Khoảng cách Euclid 3D trong WORLD space giữa 2 node */
export function distanceWorld(a: Node, b: Node): number {
  const pa = getWorldPos(a, _vA);
  const pb = getWorldPos(b, _vB);
  return Vec3.distance(pa, pb);
}

/** Bình phương khoảng cách WORLD (dùng khi chỉ cần so sánh, tiết kiệm sqrt) */
export function distanceWorldSqr(a: Node, b: Node): number {
  const pa = getWorldPos(a, _vA);
  const pb = getWorldPos(b, _vB);
  return Vec3.squaredDistance(pa, pb);
}

/** Khoảng cách theo mặt phẳng XY trong WORLD space (bỏ qua Z) – hợp cho game 2D */
export function distanceWorldXY(a: Node, b: Node): number {
  const pa = getWorldPos(a, _vA);
  const pb = getWorldPos(b, _vB);
  _vC.set(pa.x - pb.x, pa.y - pb.y, 0);
  return _vC.length();
}

/**
 * Khoảng cách LOCAL giữa 2 node khi chiếu về hệ quy chiếu `reference`.
 * - Nếu truyền `reference`: đưa A & B về local của `reference` rồi đo.
 * - Nếu không truyền: yêu cầu A và B **chung parent**; sẽ đo trong local của parent.
 */
export function distanceLocal(a: Node, b: Node, reference?: Node): number {
  const pa = toLocalOf(a, reference, _vA);
  const pb = toLocalOf(b, reference, _vB);
  return Vec3.distance(pa, pb);
}

/** Khoảng cách LOCAL theo XY (bỏ qua Z) */
export function distanceLocalXY(a: Node, b: Node, reference?: Node): number {
  const pa = toLocalOf(a, reference, _vA);
  const pb = toLocalOf(b, reference, _vB);
  _vC.set(pa.x - pb.x, pa.y - pb.y, 0);
  return _vC.length();
}

/**
 * Chuyển world position của node `n` về local của `reference`.
 * - Nếu `reference` không truyền: dùng `n.parent`. Nếu cũng không có, trả về world pos.
 */
function toLocalOf(n: Node, reference: Node | undefined, out: Vec3): Vec3 {
  out.set(n.worldPosition);

  const ref = reference ?? n.parent;
  if (!ref) return out;

  // world -> local: dùng M_ref^-1 * P_world
  ref.getWorldMatrix(_mRef);
  Mat4.invert(_mInvRef, _mRef);
  Vec3.transformMat4(out, out, _mInvRef);
  return out;
}

// --- bộ nhớ tạm dùng lại để tránh GC ---
const _vA = v3();
const _vB = v3();
const _vC = v3();
const _mRef = new Mat4();
const _mInvRef = new Mat4();

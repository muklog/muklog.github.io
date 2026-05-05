/**
 * 프로필 미리보기: photoURL 우선, 없으면 이니셜 + 배경색.
 */
export default function AvatarBubble({
  photoURL,
  name,
  color,
  size = 40,
}: {
  photoURL?: string;
  name: string;
  color?: string;
  size?: number;
}) {
  const initial = Array.from(name.trim())[0]?.toUpperCase() ?? "?";
  if (photoURL) {
    return (
      <img
        src={photoURL}
        alt=""
        referrerPolicy="no-referrer"
        style={{ width: size, height: size }}
        className="rounded-full border border-slate-800 object-cover"
      />
    );
  }
  return (
    <div
      style={{ width: size, height: size, backgroundColor: color ?? "#1f2937" }}
      className="flex items-center justify-center rounded-full border border-slate-800 text-lg font-semibold text-white"
    >
      {initial}
    </div>
  );
}

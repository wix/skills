// Responsive post grid + empty state. Token-styled; re-skin via theme.css.
import PostCard from "./PostCard";

export default function PostGrid({ posts, empty = "No posts yet." }) {
  if (!posts?.length) {
    return (
      <p style={{ color: "var(--color-muted)", padding: "var(--space)", textAlign: "center" }}>{empty}</p>
    );
  }
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
      gap: "calc(var(--space) * 1.5)",
    }}>
      {posts.map((p) => <PostCard key={p.id} post={p} />)}
    </div>
  );
}

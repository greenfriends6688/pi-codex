import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { projectIdentityKey } = await jiti.import("./project-identity.ts");
const {
  chatProjectOf,
  getProjectActivity,
  getRecentProjects,
  sessionsForProject,
  withoutChatProject,
} = await jiti.import("./project-groups.ts");

function session(id, projectRoot, modified) {
  return {
    id,
    path: `${id}.jsonl`,
    cwd: projectRoot,
    projectRoot,
    projectKey: projectIdentityKey(projectRoot, "win32"),
    created: modified,
    modified,
    messageCount: 1,
    firstMessage: id,
  };
}

test("Windows path variants form one recent project using the newest display path", () => {
  const older = session("older", "C:\\Users\\Alex\\Project\\Study\\ELM", "2026-08-12T00:00:00.000Z");
  const newer = session("newer", "c:/users/ALEX/project/study/elm", "2026-08-13T00:00:00.000Z");

  assert.deepEqual(getRecentProjects([older, newer]), [{
    key: older.projectKey,
    root: newer.projectRoot,
  }]);
});

test("project filtering includes every session with the stable identity", () => {
  const first = session("first", "C:\\Users\\Alex\\Project", "2026-08-12T00:00:00.000Z");
  const second = session("second", "c:/users/alex/project/", "2026-08-13T00:00:00.000Z");
  const other = session("other", "D:\\Elsewhere", "2026-08-13T01:00:00.000Z");

  assert.deepEqual(
    sessionsForProject([first, second, other], first.projectKey).map((item) => item.id),
    ["first", "second"],
  );
});

test("running and unread counts aggregate under the stable project identity", () => {
  const first = session("first", "C:\\Users\\Alex\\Project", "2026-08-12T00:00:00.000Z");
  const second = session("second", "c:/users/alex/project/", "2026-08-13T00:00:00.000Z");

  const activity = getProjectActivity(
    [first, second],
    new Set(["first", "second"]),
    new Set(["second"]),
  );

  assert.deepEqual(activity.get(first.projectKey), { running: 2, unread: 1 });
  assert.equal(activity.size, 1);
});

// fork:chat-workspace — the chat workspace is split out of the project list by key.
test("chat workspace is lifted out of the recent projects by its stable key", () => {
  const chat = session("chat", "C:\\Users\\Alex\\pi-web-chat", "2026-08-14T00:00:00.000Z");
  const project = session("project", "C:\\Users\\Alex\\Project", "2026-08-13T00:00:00.000Z");
  const recent = getRecentProjects([chat, project]);

  assert.deepEqual(chatProjectOf(recent, chat.projectKey), { key: chat.projectKey, root: chat.projectRoot });
  assert.deepEqual(
    withoutChatProject(recent, chat.projectKey),
    [{ key: project.projectKey, root: project.projectRoot }],
  );
});

test("unknown or empty chat key leaves the project list untouched", () => {
  const project = session("project", "C:\\Users\\Alex\\Project", "2026-08-13T00:00:00.000Z");
  const recent = getRecentProjects([project]);

  assert.equal(chatProjectOf(recent, undefined), null);
  assert.equal(chatProjectOf(recent, "C:\\elsewhere"), null);
  assert.deepEqual(withoutChatProject(recent, null), recent);
});

import assert from "node:assert/strict";
import test from "node:test";
import { parseDirectoryCsv } from "./participant-directory.js";

test("Google-справочник сопоставляет русские роли и рабочие адреса", () => {
  const people = parseDirectoryCsv([
    "ФИО,Роль в проекте,Почта рабочая",
    '"Иванов, Алексей",ГИП,a.ivanov@example.com',
    "Сидоров Иван,ГИП,i.sidorov@example.com",
    "Петров Петр,Координатор проекта,p.petrov@example.com",
  ].join("\n"));

  assert.deepEqual(people.map(({ displayName, email, role }) => ({ displayName, email, role })), [
    { displayName: "Иванов, Алексей", email: "a.ivanov@example.com", role: "gip" },
    { displayName: "Сидоров Иван", email: "i.sidorov@example.com", role: "gip" },
    { displayName: "Петров Петр", email: "p.petrov@example.com", role: "coordinator" },
  ]);
});

test("Google-справочник требует согласованные заголовки", () => {
  assert.throws(
    () => parseDirectoryCsv("Имя,Телефон\nИванов,+70000000000"),
    /нужны колонки/,
  );
});

import Time "mo:base/Time";
import Array "mo:base/Array";
import Text "mo:base/Text";
import Nat "mo:base/Nat";

actor {
  public type NoteVersion = {
    title : Text;
    content : Text;
    tags : [Text];
    author : Text;
    version : Nat;
    timestamp : Time.Time;
  };

  public type Note = {
    id : Text;
    versions : [NoteVersion];
    createdAt : Time.Time;
  };

  public type NoteSummary = {
    id : Text;
    title : Text;
    updatedAt : Time.Time;
  };

  var notes : [Note] = [];
  var nextId : Nat = 1;

  func findNote(noteId : Text) : ?Note {
    Array.find(notes, func(n : Note) : Bool { n.id == noteId });
  };

  func findVersion(noteId : Text, version : Nat) : ?NoteVersion {
    switch (findNote(noteId)) {
      case null { null };
      case (?note) {
        if (version == 0) { null }
        else {
          let idx = version - 1;
          if (idx >= note.versions.size()) { null }
          else { ?note.versions[idx] }
        }
      };
    }
  };

  public func createNote(title : Text, content : Text, tags : [Text], author : Text) : async Note {
    let id = Nat.toText(nextId);
    nextId += 1;
    let now = Time.now();
    let version : NoteVersion = {
      title = title;
      content = content;
      tags = tags;
      author = author;
      version = 1;
      timestamp = now;
    };
    let note : Note = {
      id = id;
      versions = [version];
      createdAt = now;
    };
    notes := Array.append(notes, [note]);
    note
  };

  public func updateNote(noteId : Text, title : Text, content : Text, tags : [Text], author : Text) : async ?Note {
    switch (findNote(noteId)) {
      case null { null };
      case (?note) {
        let versions = note.versions;
        let lastVersion = if (versions.size() > 0) {
          ?versions[versions.size() - 1]
        } else { null };
        let newVersionNum = switch (lastVersion) {
          case null { 1 };
          case (?v) { v.version + 1 };
        };
        let newVersion : NoteVersion = {
          title = title;
          content = content;
          tags = tags;
          author = author;
          version = newVersionNum;
          timestamp = Time.now();
        };
        let updatedNote : Note = {
          id = note.id;
          versions = Array.append(versions, [newVersion]);
          createdAt = note.createdAt;
        };
        notes := Array.map(notes, func(n : Note) : Note {
          if (n.id == noteId) { updatedNote } else { n }
        });
        ?updatedNote
      };
    }
  };

  public func deleteNote(noteId : Text) : async Bool {
    let filtered = Array.filter(notes, func(n : Note) : Bool { n.id != noteId });
    if (filtered.size() == notes.size()) {
      false
    } else {
      notes := filtered;
      true
    }
  };

  public query func getNote(noteId : Text) : async ?Note {
    findNote(noteId)
  };

  public query func getNoteVersion(noteId : Text, version : Nat) : async ?NoteVersion {
    findVersion(noteId, version)
  };

  public query func getVersionHistory(noteId : Text) : async ?[NoteVersion] {
    switch (findNote(noteId)) {
      case null { null };
      case (?note) { ?note.versions };
    }
  };

  public query func getAllNotes() : async [NoteSummary] {
    Array.map(notes, func(n : Note) : NoteSummary {
      let lastTitle = if (n.versions.size() > 0) {
        ?n.versions[n.versions.size() - 1]
      } else { null };
      let title = switch (lastTitle) {
        case null { "" };
        case (?v) { v.title };
      };
      let lastTime = if (n.versions.size() > 0) {
        ?n.versions[n.versions.size() - 1]
      } else { null };
      let time = switch (lastTime) {
        case null { n.createdAt };
        case (?v) { v.timestamp };
      };
      { id = n.id; title = title; updatedAt = time }
    })
  };

  public query func proveExistence(noteId : Text, version : Nat) : async ?NoteVersion {
    findVersion(noteId, version)
  };
};

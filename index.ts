import { Effect } from "effect";

console.log(Effect.succeed("Hello via Effect!").pipe(Effect.runSync));

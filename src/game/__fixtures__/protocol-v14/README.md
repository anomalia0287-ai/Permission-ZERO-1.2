# Saves written by the protocol-v14 build

Real campaigns, encoded by the build at commit `8116716` — the one that was
live when v15 was adjudicated. They are checked in so that every later
adjudication has to prove it still opens them.

Each file is a campaign parked at a state the v15 story change touches:

| file | state |
| --- | --- |
| `a-recovering.json` | two of the three records recovered |
| `b-message-pending-next-day.json` | all three recovered, the supervisor's reply scheduled for the following day the way v14 scheduled it |
| `b2-decision-open.json` | that reply on screen, the decision waiting |
| `c-liberated-ended.json` | supervisor liberated, campaign closed on the takeover ending |
| `d-terminated-ended.json` | supervisor erased, campaign closed on the takeover ending |
| `e-deferred.json` | decision deferred |
| `f-present-with-exit.json` | supervisor untouched, the exit node owned |

Regenerate only by checking out the build that wrote them. Editing the JSON by
hand defeats the point: their value is that no current code produced them.

import re

from analysis.demos import DEMOS, MAX_DEMO_SECONDS
from analysis.exercises import EXERCISES


def test_every_exercise_has_a_short_demo():
    assert set(DEMOS) == set(EXERCISES)
    for key, d in DEMOS.items():
        assert re.fullmatch(r"[\w-]{11}", d.youtube_id), key
        assert 0 < d.seconds < MAX_DEMO_SECONDS, key
        assert d.channel and d.title, key


def test_demo_videos_are_not_reused():
    ids = [d.youtube_id for d in DEMOS.values()]
    assert len(ids) == len(set(ids))


def test_demo_json_links_to_youtube():
    d = DEMOS["neck_tilt"].to_json()
    assert d["url"] == f"https://www.youtube.com/watch?v={d['youtube_id']}"
    assert set(d) == {"youtube_id", "seconds", "channel", "title", "url"}

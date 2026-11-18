import copy
import json
from pathlib import Path
import tempfile
import unittest
from data_tools.runtime import ReferenceCache, atomic_write
from data_tools.wiki import synchronize

ROOT = Path(__file__).resolve().parents[1]

class DataTests(unittest.TestCase):
    def test_atomic_save(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/"plan.json"
            atomic_write(path,b'{"version":1}')
            atomic_write(path,b'{"version":2}')
            self.assertEqual(json.loads(path.read_bytes())["version"],2)
            self.assertEqual(len(list(Path(directory).iterdir())),1)

    def test_reference_path_allowlist(self):
        with tempfile.TemporaryDirectory() as directory:
            cache=ReferenceCache(Path(directory))
            with self.assertRaises(ValueError):cache.get("../../private")

    def test_wiki_overlay_preserves_icon_ids_and_special_mechanics(self):
        db={"items":{"Logs":{"id":1,"buyPrice":200},"Plank":{"id":101},"Coal":{"id":604,"heat":540}},"machines":{"Table Saw":{},"Cauldron":{}},"recipes":[{"id":"Plank","machine":"Table Saw","inputs":{"Logs":1},"outputs":{"Plank":200},"baseTime":500},{"id":"special","machine":"Cauldron","inputs":{"Plank":3},"outputs":{"Coal":1},"baseTime":3}]}
        items=[{"id":"logs","name":"Logs","cost":200},{"id":"plank","name":"Plank","id_num":999,"heat_value":20},{"id":"coal","name":"Coal","heat_value":540}]
        recipes=[{"id":"plank","crafted_in":"table saw","inputs":[{"name":"Logs","count":1}],"outputs":[{"name":"Plank","count":200}],"time":400}]
        source="const I=JSON.parse(`"+json.dumps(items)+"`);const R=JSON.parse(`"+json.dumps(recipes)+"`);"
        result,count,warnings=synchronize(db,source)
        self.assertEqual(result["items"]["Plank"]["id"],101)
        self.assertEqual(result["recipes"][0]["baseTime"],400)
        self.assertEqual(result["recipes"][1],db["recipes"][1])
        self.assertEqual(db["recipes"][0]["baseTime"],500)
        self.assertEqual(count,1)

    def test_invalid_wiki_does_not_mutate_input(self):
        db={"items":{},"recipes":[],"machines":{}}
        old=copy.deepcopy(db)
        with self.assertRaises(ValueError):synchronize(db,"not a dataset")
        self.assertEqual(db,old)

if __name__ == "__main__":unittest.main()

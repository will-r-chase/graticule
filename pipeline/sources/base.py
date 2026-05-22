from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class LayerMeta:
    name: str           # display name, e.g. "Land", "Admin 0 Polygons"
    object_name: str    # TopoJSON object key, e.g. "land", "admin0"
    file_path: str      # relative path within the output dir


@dataclass
class DatasetMeta:
    id: str
    name: str
    description: str
    source: str
    source_name: str
    admin_level: int
    region: str
    license: str
    tags: list[str]
    file_path: str        # relative path of primary/default file; for multi-layer datasets this is the directory
    feature_count: int = 0
    bbox: list[float] = field(default_factory=lambda: [-180, -90, 180, 90])
    layers: list[LayerMeta] = field(default_factory=list)  # populated for multi-layer datasets


class DataSource(ABC):
    def __init__(self, output_dir: Path):
        self.output_dir = output_dir

    @abstractmethod
    def fetch(self) -> list[DatasetMeta]:
        """Download, process, and write TopoJSON files. Return metadata for each dataset."""
        pass

from setuptools import setup, find_packages

setup(
    name="mjolnir",
    version="0.0.1",
    packages=find_packages(),
    description="Mjolnir Antispam",
    include_package_data=True,
    zip_safe=True,
    install_requires=[
        "matrix-common >= 1.0.0"
    ],
)
